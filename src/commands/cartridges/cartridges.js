import path from 'path';
import inquirer from 'inquirer';
import { getAvailableRealms, getRealmConfig, getInstanceType } from '../../index.js';
import { findCartridgeFolders, calculateValidationStats, getSiblingRepositories } from '../../io/util.js';
import { exportSitesCartridgesToCSV } from '../../io/csv.js';
import { compareCartridges, exportComparisonToFile } from './helpers/cartridgeComparison.js';
import { fetchAndTransformSites, fetchSitesFromAllRealms } from './helpers/siteHelper.js';
import { LOG_PREFIX, IDENTIFIERS } from '../../config/constants.js';
import {
    logCartridgeList,
    logCartridgeValidationSummaryHeader,
    logRealmsProcessed,
    logCartridgeValidationStats,
    logCartridgeValidationWarning,
    logCartridgeValidationSummaryFooter,
    logSiteXmlValidationSummary
} from '../../helpers/log.js';
import {
    findSiteXmlFiles,
    parseAndCompareSiteXmls,
    exportSiteXmlComparison
} from '../../io/siteXmlHelper.js';
import { realmPrompt, repositoryPrompt } from '../prompts/index.js';
import { resolveRealmScopeSelection } from '../prompts/commonPrompts.js';

// ============================================================================
// SHARED HELPERS
// ============================================================================

/**
 * Prompt user to select a sibling repository and return the resolved path
 * @returns {Promise<string|null>} Resolved repository path, or null if none found
 */
async function promptForRepositoryPath() {
    const siblings = await getSiblingRepositories();
    if (siblings.length === 0) {
        console.log('No sibling repositories found.');
        return null;
    }

    const answers = await inquirer.prompt(await repositoryPrompt(siblings));
    return path.join(path.dirname(process.cwd()), answers.repository);
}

/**
 * Derive a single instance type from a list of realms, if all share the same type
 * @param {string[]} realms - Realm names
 * @returns {string|null} Instance type if uniform, null otherwise
 */
function deriveInstanceType(realms) {
    if (!realms || realms.length === 0) {
        return null;
    }
    const types = new Set(realms.map((realm) => getInstanceType(realm)));
    return types.size === 1 ? Array.from(types)[0] : null;
}

// ============================================================================
// LIST SITES COMMAND
// ============================================================================

/**
 * List all sites and export cartridge paths to CSV
 * @param {string} realm - Realm name to fetch sites from
 * @returns {Promise<void>}
 */
export async function executeListSites(realm) {
    await exportSitesCartridgesToCSV(realm);
}

// ============================================================================
// VALIDATE CARTRIDGES ALL COMMAND
// ============================================================================

/**
 * Validate cartridges across ALL configured realms in parallel
 * @param {string} repositoryPath - Path to the repository containing cartridges
 * @param {string} [instanceTypeOverride] - Optional instance type override for output path
 * @returns {Promise<void>}
 */
export async function executeValidateCartridgesAll(
    repositoryPath,
    realmsToProcess = null,
    instanceTypeOverride = null
) {
    const selectedRepo = path.basename(repositoryPath);
    const cartridges = findCartridgeFolders(repositoryPath);
    const availableRealms = realmsToProcess && realmsToProcess.length > 0
        ? realmsToProcess
        : getAvailableRealms();

    console.log('\n[WIP] Validating cartridge paths across all realms...');
    console.log(`\n${LOG_PREFIX.INFO} Selected: ${selectedRepo}`);
    console.log(`  Validating cartridges in: ${selectedRepo}\n`);

    if (cartridges.length === 0) {
        console.log('No cartridges found in the selected repository.');
        return;
    }

    logCartridgeList(cartridges);

    if (availableRealms.length === 0) {
        console.log('No realms configured.');
        return;
    }

    // Fetch sites from all realms in parallel
    console.log(`Fetching sites from ${availableRealms.length} realm(s) in parallel...\n`);
    const { allSites, realmSummary } = await fetchSitesFromAllRealms(availableRealms);

    if (allSites.length === 0) {
        console.log('\nNo sites found across any realm. Aborting.\n');
        return;
    }

    console.log(`\n${LOG_PREFIX.INFO} Aggregated ${allSites.length} site(s) `
        + `across ${realmSummary.length} realm(s)\n`);

    // Compare and export
    console.log('Comparing discovered cartridges with cartridges used across ALL realms...\n');
    const comparisonResult = compareCartridges(cartridges, allSites);
    const instanceTypeScope = instanceTypeOverride || deriveInstanceType(realmsToProcess);

    const consolidatedFilePath = await exportComparisonToFile(
        comparisonResult,
        IDENTIFIERS.ALL_REALMS,
        instanceTypeScope
    );
    console.log(`${LOG_PREFIX.INFO} Consolidated comparison saved to: ${consolidatedFilePath}\n`);

    return { realmSummary, comparisonResult, consolidatedFilePath };
}

// ============================================================================
// VALIDATE SITE XML COMMAND
// ============================================================================

/**
 * Validate that site.xml files match live SFCC cartridge paths
 * @param {string} repositoryPath - Path to the repository containing site.xml files
 * @param {string} realm - Realm name to validate against
 * @returns {Promise<Object>} Validation results including stats and report path
 */
export async function executeValidateSiteXml(repositoryPath, realm) {
    const selectedRepo = path.basename(repositoryPath);
    const realmConfig = getRealmConfig(realm);

    console.log('\n[WIP] Validating site.xml files against live SFCC...');
    console.log(`\n${LOG_PREFIX.INFO} Selected: ${selectedRepo}\n`);

    // Validate configuration
    if (!realmConfig.siteTemplatesPath) {
        console.log(
            `\n${LOG_PREFIX.ERROR} Realm "${realm}" does not have "siteTemplatesPath" configured in config.json\n`
        );
        console.log('Please add "siteTemplatesPath" to the realm configuration.');
        console.log('Example: "siteTemplatesPath": "sites/site_template_bcwr080"\n');
        return null;
    }

    console.log(`Site Templates Path: ${realmConfig.siteTemplatesPath}\n`);

    // Find and list site.xml files
    const siteXmlFiles = await findSiteXmlFiles(repositoryPath, realmConfig.siteTemplatesPath);

    if (siteXmlFiles.length === 0) {
        console.log('No site.xml files found.\n');
        return null;
    }

    console.log(`Found ${siteXmlFiles.length} site.xml file(s):\n`);
    for (const file of siteXmlFiles) {
        console.log(`  \u2192 ${file.siteLocale}: ${file.relativePath}`);
    }
    console.log();

    // Fetch live sites and build lookup map
    console.log('Fetching live site data from SFCC...');
    const validSites = await fetchAndTransformSites(realm);

    if (!validSites || validSites.length === 0) {
        console.log('No sites found on SFCC.\n');
        return null;
    }

    const liveSitesMap = Object.fromEntries(
        validSites.map((site) => [site.id, site.cartridges])
    );

    // Parse and compare
    console.log('\nParsing and comparing site.xml files...\n');
    const comparisons = await parseAndCompareSiteXmls(siteXmlFiles, liveSitesMap);

    if (comparisons.length === 0) {
        console.log('\nNo comparisons to export.\n');
        return null;
    }

    // Export and return stats
    const reportPath = await exportSiteXmlComparison(comparisons, realm);
    console.log(`\n${LOG_PREFIX.INFO} Validation report saved to: ${reportPath}\n`);

    const stats = calculateValidationStats(comparisons);
    return { stats, reportPath, comparisons };
}

// ============================================================================
// COMMAND REGISTRATION
// ============================================================================

/**
 * Register cartridge commands with the CLI
 * @param {Command} program - Commander program instance
 */
export function registerCartridgeCommands(program) {
    program
        .command('list-sites')
        .description('List all sites and export cartridge paths to CSV')
        .action(async () => {
            const selection = await resolveRealmScopeSelection(inquirer.prompt);
            const realmsToProcess = selection.realmList;

            if (!realmsToProcess || realmsToProcess.length === 0) {
                console.log('No realms found for the selected scope.');
                return;
            }

            for (const realm of realmsToProcess) {
                await executeListSites(realm);
            }
        });

    program
        .command('validate-cartridges-all')
        .description('[WIP] Validate cartridges across ALL configured realms (parallel)')
        .action(async () => {
            const selection = await resolveRealmScopeSelection(inquirer.prompt);
            const { realmList, instanceTypeOverride } = selection;

            if (!realmList || realmList.length === 0) {
                console.log('No realms found for the selected scope.');
                return;
            }

            const targetPath = await promptForRepositoryPath();
            if (!targetPath) {
                return;
            }

            const result = await executeValidateCartridgesAll(
                targetPath,
                realmList,
                instanceTypeOverride
            );

            if (!result) {
                return;
            }

            logCartridgeValidationSummaryHeader();
            logRealmsProcessed(result.realmSummary);
            logCartridgeValidationStats(result);

            if (result.comparisonResult.unused.length > 0) {
                logCartridgeValidationWarning(
                    result.comparisonResult.unused.length,
                    result.consolidatedFilePath
                );
            }

            logCartridgeValidationSummaryFooter();
        });

    program
        .command('validate-site-xml')
        .description('[WIP] Validate that site.xml files match live SFCC cartridge paths')
        .action(async () => {
            const targetPath = await promptForRepositoryPath();
            if (!targetPath) {
                return;
            }

            const realmAnswers = await inquirer.prompt(realmPrompt());
            const result = await executeValidateSiteXml(targetPath, realmAnswers.realm);

            if (!result) {
                return;
            }

            logSiteXmlValidationSummary(result.stats);
        });
}
