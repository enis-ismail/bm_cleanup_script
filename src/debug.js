import inquirer from 'inquirer';
import { startTimer } from './helpers/timer.js';
import { getSitePreferences } from './api.js';
import { exportAttributesToCSV } from './helpers/csv.js';
import {
    realmPrompt,
    objectTypePrompt,
    scopePrompts,
    includeDefaultsPrompt,
    resolveRealmScopeSelection
} from './prompts.js';
import {
    logCheckPreferencesStart,
    logNoMatrixFiles,
    logMatrixFilesFound,
    logSummaryHeader,
    logRealmSummary,
    logSummaryFooter
} from './helpers/log.js';
import path from 'path';
import { findAllMatrixFiles, getInstanceType } from './helpers.js';
import { processPreferenceMatrixFiles, executePreferenceSummarization } from './helpers/preferenceHelper.js';
import { getActivePreferencesFromMatrices, findAllActivePreferencesUsage, findPreferenceUsage } from './helpers/preferenceUsage.js';
import { getSiblingRepositories } from './helpers/util.js';
import { repositoryPrompt, preferenceIdPrompt } from './prompts.js';

// ============================================================================
// DEBUG COMMANDS
// Deprecated commands kept for backward compatibility and debugging
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
 * Register deprecated debug commands with the CLI program
 * @param {Command} program - Commander.js program instance
 */
export function registerDebugCommands(program) {
    program
        .command('get-preferences')
        .description('(Deprecated: use analyze-preferences) Export preference definitions to CSV')
        .action(async () => {
            console.log('Note: This command is simplified. Use "analyze-preferences" for full workflow.');
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const realmName = realmAnswers.realm;
            const answers = await inquirer.prompt([
                ...objectTypePrompt(),
                ...includeDefaultsPrompt()
            ]);
            const allAttributes = await getSitePreferences(
                answers.objectType,
                realmName,
                answers.includeDefaults
            );
            await exportAttributesToCSV(allAttributes, realmName);
        });

    program
        .command('summarize-preferences')
        .description('(Deprecated: use analyze-preferences) Summarize preferences (includes fetching)')
        .action(async () => {
            console.log('Note: This command is simplified. Use "analyze-preferences" for full workflow.');
            const timer = startTimer();
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

            for (const realm of realmsToProcess) {
                console.log(`\nProcessing realm: ${realm}`);
                await executePreferenceSummarization({
                    realm,
                    objectType,
                    instanceType: getInstanceType(realm),
                    scope,
                    siteId,
                    includeDefaults
                });
            }

            console.log(`\n✓ Total runtime: ${timer.stop()}`);
        });

    program
        .command('check-preferences')
        .description('(Deprecated: use analyze-preferences) Check preference usage from matrix files')
        .action(async () => {
            console.log('Note: This command is simplified. Use "analyze-preferences" for full workflow.');
            logCheckPreferencesStart();

            const matrixFiles = findAllMatrixFiles();

            if (matrixFiles.length === 0) {
                logNoMatrixFiles();
                return;
            }

            logMatrixFilesFound(matrixFiles.length);

            const summary = await processPreferenceMatrixFiles(matrixFiles);

            logSummaryHeader();
            for (const stats of summary) {
                logRealmSummary(stats);
            }
            logSummaryFooter();
        });

    program
        .command('test-active-preferences')
        .description('(Debug) Display all active preferences from matrix files')
        .action(async () => {
            const matrixFiles = findAllMatrixFiles();

            if (matrixFiles.length === 0) {
                console.log('No matrix files found.');
                return;
            }

            console.log(`Found ${matrixFiles.length} matrix file(s)\n`);

            const matrixFilePaths = matrixFiles.map(f => f.matrixFile);
            const activePreferences = Array.from(getActivePreferencesFromMatrices(matrixFilePaths)).sort();
            const count = activePreferences.length;

            console.log(`Active Preferences (${count}):\n`);
            activePreferences.forEach((pref) => {
                console.log(`  • ${pref}`);
            });
        });

    program
        .command('find-all-preference-usage')
        .description('(Deprecated: use analyze-preferences STEP 5) Find usage for all active preferences across all realms')
        .action(async () => {
            console.log('Note: This command is now STEP 5 of "analyze-preferences" for full workflow.');
            const timer = startTimer();
            const siblings = await getSiblingRepositories();

            if (siblings.length === 0) {
                console.log('No sibling repositories found.');
                return;
            }

            const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
            const targetPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

            const results = await findAllActivePreferencesUsage(targetPath);

            console.log('\nPREFERENCE USAGE SUMMARY\n');

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

            console.log(`\n✓ Total runtime: ${timer.stop()}`);
        });

    program
        .command('find-preference-usage')
        .description('(Debug) Find cartridges using a specific preference ID')
        .action(async () => {
            const timer = startTimer();
            const siblings = await getSiblingRepositories();

            if (siblings.length === 0) {
                console.log('No sibling repositories found.');
                return;
            }

            const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
            const targetPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

            const preferenceAnswers = await inquirer.prompt(preferenceIdPrompt());
            const result = await findPreferenceUsage(
                preferenceAnswers.preferenceId,
                targetPath
            );

            const { preferenceId, repositoryPath, deprecatedCartridgesCount, totalMatches, cartridges } = result;

            console.log(`\nPreference ID: ${preferenceId}`);
            console.log(`Repository: ${repositoryPath}`);
            console.log(`Deprecated cartridges filtered: ${deprecatedCartridgesCount}`);
            console.log(`Matches found: ${totalMatches}`);
            console.log(`\nCartridges using this preference (${cartridges.length}):`);

            if (cartridges.length === 0) {
                console.log('No cartridges found.');
            } else {
                cartridges.forEach((cartridge) => {
                    console.log(`  • ${cartridge}`);
                });
            }

            console.log(`\n✓ Total runtime: ${timer.stop()}`);
        });
}
