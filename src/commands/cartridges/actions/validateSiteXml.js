import path from 'path';
import inquirer from 'inquirer';
import { getRealmConfig } from '../../../index.js';
import { calculateValidationStats } from '../../../io/util.js';
import { fetchAndTransformSites } from '../helpers/siteHelper.js';
import { LOG_PREFIX } from '../../../config/constants.js';
import { logSiteXmlValidationSummary } from '../../../scripts/loggingScript/log.js';
import {
    findSiteXmlFiles,
    parseAndCompareSiteXmls,
    exportSiteXmlComparison
} from '../../../io/siteXmlHelper.js';
import { realmPrompt } from '../../prompts/index.js';
import { promptForRepositoryPath } from './shared.js';

// ============================================================================
// VALIDATE SITE XML
// Validate that site.xml files match live SFCC cartridge paths
// ============================================================================

/**
 * Validate that site.xml files match live SFCC cartridge paths (command handler).
 */
export async function validateSiteXml() {
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
}

/**
 * Validate that site.xml files match live SFCC cartridge paths.
 * @param {string} repositoryPath - Path to the repository containing site.xml files
 * @param {string} realm - Realm name to validate against
 * @returns {Promise<Object|null>} Validation results including stats and report path
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
