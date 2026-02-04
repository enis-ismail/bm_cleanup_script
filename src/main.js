import inquirer from 'inquirer';
import { Command } from 'commander';
import path from 'path';
import { registerDebugCommands } from './debug.js';
import {
    addRealmToConfig,
    removeRealmFromConfig,
    findAllMatrixFiles,
    getAvailableRealms,
    getInstanceType
} from './helpers.js';
import { startTimer } from './helpers/timer.js';
import { getSiblingRepositories } from './helpers/util.js';
import { executeListSites, executeValidateCartridgesAll, executeValidateSiteXml } from './helpers/cartridgeCommands.js';
import {
    realmPrompt,
    objectTypePrompt,
    addRealmPrompts,
    selectRealmToRemovePrompt,
    confirmRealmRemovalPrompt,
    scopePrompts,
    repositoryPrompt,
    includeDefaultsPrompt,
    resolveRealmScopeSelection
} from './prompts.js';
import {
    logNoMatrixFiles,
    logMatrixFilesFound,
    logSummaryHeader,
    logRealmSummary,
    logSummaryFooter,
    logCartridgeValidationSummaryHeader,
    logRealmsProcessed,
    logCartridgeValidationStats,
    logCartridgeValidationWarning,
    logCartridgeValidationSummaryFooter,
    logSiteXmlValidationSummary,
    logSectionTitle,
    logStatusUpdate,
    logStatusClear
} from './helpers/log.js';
import { processPreferenceMatrixFiles, executePreferenceSummarization } from './helpers/preferenceHelper.js';
import {
    findAllActivePreferencesUsage,
    getActivePreferencesFromMatrices
} from './helpers/preferenceUsage.js';

// ============================================================================
// CLI ENTRYPOINT
// Central command registry for OCAPI tooling
// ============================================================================

/**
 * Validate realm selection and return list to process
 * @param {Array<string>} realmsToProcess - List of realms from selection
 * @returns {boolean} True if realms are valid, false otherwise
 * @private
 */
function validateRealmsSelection(realmsToProcess) {
    if (!realmsToProcess || realmsToProcess.length === 0) {
        console.log('No realms found for the selected scope.');
        return false;
    }
    return true;
}

/**
 * Get target repository path from sibling repositories
 * @param {Array<string>} siblings - List of sibling repository names
 * @returns {Promise<string|null>} Target path or null if cancelled/invalid
 * @private
 */
async function selectRepositoryPath(siblings) {
    if (siblings.length === 0) {
        console.log('No sibling repositories found.');
        return null;
    }

    const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
    return path.join(path.dirname(process.cwd()), siblingAnswers.repository);
}
const program = new Command();

// Command to list sites and export cartridge paths
program
    .name('OCAPI Tools')
    .description('Tools for working with SFCC OCAPI')
    .version('1.0.0');

// ============================================================================
// CORE COMMANDS
// Primary workflows intended for regular use
// ============================================================================

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
    .command('analyze-preferences')
    .description('Full preference analysis workflow: fetch → summarize → check')
    .action(async () => {
        const timer = startTimer();

        logSectionTitle('STEP 1: Configure Scope & Options');

        const siblings = await getSiblingRepositories();
        const repositoryAnswers = await inquirer.prompt(repositoryPrompt(siblings));
        const { repository: repositoryPath } = repositoryAnswers;

        const selection = await resolveRealmScopeSelection(inquirer.prompt);
        const realmsToProcess = selection.realmList;

        if (!validateRealmsSelection(realmsToProcess)) {
            return;
        }

        const answers = await inquirer.prompt([
            ...objectTypePrompt('SitePreferences'),
            ...scopePrompts(),
            ...includeDefaultsPrompt()
        ]);

        const { objectType, scope, siteId, includeDefaults } = answers;

        logSectionTitle('STEP 2: Fetching & Summarizing Preferences');

        for (const realm of realmsToProcess) {
            logStatusUpdate(`Fetching preferences for ${realm}`);
            await executePreferenceSummarization({
                realm,
                objectType,
                instanceType: getInstanceType(realm),
                scope,
                siteId,
                includeDefaults
            });
            logStatusClear();
        }

        console.log('');

        logSectionTitle('STEP 3: Checking Preference Usage');

        const matrixFiles = findAllMatrixFiles();

        if (matrixFiles.length === 0) {
            logNoMatrixFiles();
            console.log(`\n✓ Total runtime: ${timer.stop()}`);
            return;
        }

        logMatrixFilesFound(matrixFiles.length);

        const summary = await processPreferenceMatrixFiles(matrixFiles);

        logSummaryHeader();
        for (const stats of summary) {
            logRealmSummary(stats);
        }
        logSummaryFooter();

        logSectionTitle('STEP 4: Active Preferences Summary');

        const matrixFilePaths = matrixFiles.map(f => f.matrixFile);
        const activePreferences = Array.from(getActivePreferencesFromMatrices(matrixFilePaths)).sort();
        const count = activePreferences.length;

        console.log(`Active Preferences (${count}):\n`);
        activePreferences.forEach((pref) => {
            console.log(`  • ${pref}`);
        });

        logSectionTitle('STEP 5: Finding Preference Usage in Cartridges');

        if (repositoryPath) {
            const results = await findAllActivePreferencesUsage(repositoryPath);

            for (const result of results) {
                console.log(`${result.preferenceId}:`);
                if (result.cartridges.length === 0) {
                    console.log('  (not used in any cartridge)');
                } else {
                    result.cartridges.forEach((cartridge) => {
                        console.log(`  • ${cartridge}`);
                    });
                }
            }
        }

        console.log(`\n✓ Total runtime: ${timer.stop()}`);
    });

program
    .command('add-realm')
    .description('Add a new realm to config.json')
    .action(async () => {
        const answers = await inquirer.prompt(addRealmPrompts());
        const { name, hostname, clientId, clientSecret, siteTemplatesPath, instanceType } = answers;
        addRealmToConfig(name, hostname, clientId, clientSecret, siteTemplatesPath, instanceType);
    });

program
    .command('remove-realm')
    .description('Remove a realm from config.json')
    .action(async () => {
        const realms = getAvailableRealms();
        if (realms.length === 0) {
            console.log('No realms available to remove.');
            return;
        }

        const selectAnswer = await inquirer.prompt(selectRealmToRemovePrompt(realms));
        const confirmAnswer = await inquirer.prompt(
            confirmRealmRemovalPrompt(selectAnswer.realmToRemove)
        );

        if (confirmAnswer.confirm) {
            await removeRealmFromConfig(selectAnswer.realmToRemove);
        } else {
            console.log('Realm removal cancelled.');
        }
    });

// ============================================================================
// WIP COMMANDS (Work In Progress)
// Experimental commands being developed
// ============================================================================

program
    .command('validate-cartridges-all')
    .description('[WIP] Validate cartridges across ALL configured realms (parallel)')
    .action(async () => {
        const selection = await resolveRealmScopeSelection(inquirer.prompt);
        const { realmList, instanceTypeOverride } = selection;

        if (!validateRealmsSelection(realmList)) {
            return;
        }

        const siblings = await getSiblingRepositories();
        const targetPath = await selectRepositoryPath(siblings);

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
        const siblings = await getSiblingRepositories();
        const targetPath = await selectRepositoryPath(siblings);

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

// ============================================================================
// REGISTER DEBUG COMMANDS
// ============================================================================

registerDebugCommands(program);

program.parse();
