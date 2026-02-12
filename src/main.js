import inquirer from 'inquirer';
import { Command } from 'commander';
import path from 'path';
import { spawn } from 'child_process';
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
    resolveRealmScopeSelection,
    instanceTypePrompt,
    confirmPreferenceDeletionPrompt,
    runAnalyzePreferencesPrompt,
    realmByInstanceTypePrompt,
    useExistingBackupsForAllRealmsPrompt
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
    logSectionTitle
} from './helpers/log.js';
import { processPreferenceMatrixFiles, executePreferenceSummarization, checkBackupStatusForRealms } from './helpers/preferenceHelper.js';
import {
    findAllActivePreferencesUsage,
    getActivePreferencesFromMatrices
} from './helpers/preferenceUsage.js';
import {
    loadPreferencesForDeletion,
    openPreferencesForDeletionInEditor,
    generateDeletionSummary
} from './helpers/preferenceRemoval.js';
import { loadBackupFile } from './helpers/preferenceBackup.js';

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
        const repositoryAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
        const repositoryPath = path.join(path.dirname(process.cwd()), repositoryAnswers.repository);

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

        // Check backup status for all realms if includeDefaults is true
        let useCachedBackup = false;
        if (includeDefaults) {
            const backupStatus = await checkBackupStatusForRealms(realmsToProcess, objectType);
            const validBackups = backupStatus.filter(b => b.exists && !b.tooOld);
            const tooOldBackups = backupStatus.filter(b => b.exists && b.tooOld);

            if (validBackups.length > 0) {
                console.log('\n================================================================================');
                console.log('BACKUP FILES FOUND');
                console.log('================================================================================\n');

                validBackups.forEach(backup => {
                    console.log(`  ✓ ${backup.realm}: ${backup.ageInDays} day${backup.ageInDays === 1 ? '' : 's'} old`);
                });

                if (tooOldBackups.length > 0) {
                    console.log('\nBackups older than 14 days (will fetch fresh):');
                    tooOldBackups.forEach(backup => {
                        console.log(`  ⚠ ${backup.realm}: ${backup.ageInDays} days old`);
                    });
                }

                console.log('');

                const backupAnswer = await inquirer.prompt(useExistingBackupsForAllRealmsPrompt({
                    availableCount: validBackups.length,
                    totalCount: realmsToProcess.length
                }));

                useCachedBackup = backupAnswer.useExisting;

                if (useCachedBackup) {
                    console.log('✓ Will use cached backups where available.\n');
                } else {
                    console.log('✓ Will fetch fresh data for all realms.\n');
                }
            }
        }

        logSectionTitle('STEP 2: Fetching & Summarizing Preferences');

        for (const realm of realmsToProcess) {
            await executePreferenceSummarization({
                realm,
                objectType,
                instanceType: getInstanceType(realm),
                scope,
                siteId,
                includeDefaults,
                useCachedBackup
            });
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

        if (repositoryPath && realmsToProcess.length > 0) {
            // Use first realm's instance type for results directory
            const firstRealmInstanceType = getInstanceType(realmsToProcess[0]);
            await findAllActivePreferencesUsage(repositoryPath, {
                instanceTypeOverride: firstRealmInstanceType
            });
        }

        console.log(`\n✓ Total runtime: ${timer.stop()}`);
    });

program
    .command('remove-preferences')
    .description('Remove preferences marked for deletion from site preferences')
    .action(async () => {
        const timer = startTimer();

        logSectionTitle('STEP 1: Select Instance Type');

        const instanceTypeAnswers = await inquirer.prompt(instanceTypePrompt('development'));
        const { instanceType } = instanceTypeAnswers;

        logSectionTitle('STEP 2: Load Preferences for Deletion');

        let preferences = loadPreferencesForDeletion(instanceType);

        if (!preferences) {
            console.log(`\n⚠ Preferences for deletion file not found for instance type: ${instanceType}\n`);

            const analyzeAnswers = await inquirer.prompt(runAnalyzePreferencesPrompt(instanceType));

            if (!analyzeAnswers.runAnalyze) {
                console.log('\n✓ Preference removal cancelled.\n');
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            console.log('\nRunning analyze-preferences command...\n');
            console.log('================================================================================\n');

            // Run analyze-preferences in the current terminal and wait for completion
            await new Promise((resolve, reject) => {
                const analyzeProcess = spawn('node', ['src/main.js', 'analyze-preferences'], {
                    stdio: 'inherit',
                    shell: true
                });

                analyzeProcess.on('close', (code) => {
                    console.log('\n================================================================================\n');
                    if (code === 0) {
                        console.log('✓ analyze-preferences completed successfully!\n');
                        resolve();
                    } else {
                        reject(new Error(`analyze-preferences exited with code ${code}`));
                    }
                });

                analyzeProcess.on('error', (error) => {
                    reject(error);
                });
            }).catch((error) => {
                console.log(`\n❌ Error: ${error.message}`);
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            });

            // Reload preferences after analyze-preferences completes
            preferences = loadPreferencesForDeletion(instanceType);
            if (!preferences) {
                console.log('\n⚠ Preferences file still not found. Please check the analyze-preferences output.\n');
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }
        }

        logSectionTitle('STEP 3: Review Preferences for Deletion');

        try {
            const filePath = await openPreferencesForDeletionInEditor(instanceType);
            console.log(`✓ Opened preferences file in VS Code: ${filePath}\n`);
        } catch (error) {
            console.log(`⚠ Could not open file in VS Code: ${error.message}`);
            console.log('  Make sure VS Code is installed and accessible via the "code" command.\n');
            console.log(`✓ Total runtime: ${timer.stop()}`);
            return;
        }

        const summary = generateDeletionSummary(preferences);
        console.log('Top Preference Prefixes Being Removed:');
        summary.topPrefixes.forEach(([prefix, count]) => {
            const percentage = ((count / summary.total) * 100).toFixed(1);
            console.log(`  • ${prefix}: ${count} (${percentage}%)`);
        });
        console.log('');

        logSectionTitle('STEP 4: Confirm Deletion');

        const confirmAnswers = await inquirer.prompt(confirmPreferenceDeletionPrompt(preferences.length));

        if (!confirmAnswers.confirm) {
            console.log('\n✓ Preference removal cancelled.\n');
            console.log(`✓ Total runtime: ${timer.stop()}`);
            return;
        }

        logSectionTitle('STEP 5: Verify Backup Exists');

        console.log('Checking for existing backup file...\n');

        // Select realm for backup verification
        const realmAnswers = await inquirer.prompt(realmByInstanceTypePrompt(instanceType));
        const realm = realmAnswers.realm;

        console.log(`Instance type: ${instanceType}`);
        console.log(`Realm: ${realm}`);
        console.log(`Total preferences to delete: ${preferences.length}\n`);

        try {
            // Find existing backup file generated during analyze-preferences
            const backupDir = path.join(process.cwd(), 'backup', instanceType);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            const backupFilePath = path.join(backupDir, `${realm}_SitePreferences_backup_${timestamp}.json`);

            // Verify backup file exists
            const backup = await loadBackupFile(backupFilePath);

            console.log(`\n✓ Backup file found:`);
            console.log(`  ${backupFilePath}`);
            console.log(`  Total attributes in backup: ${backup.total_attributes}`);
            console.log(`  Backup date: ${backup.backup_date}\n`);
            console.log('Note: This backup was generated during analyze-preferences and can be used to restore preferences if needed.');
        } catch (error) {
            console.error(`\n✗ Backup file not found or invalid: ${error.message}`);
            console.log('\nPlease run analyze-preferences first to generate the backup file.');
            console.log('Aborting preference removal.\n');
            console.log(`✓ Total runtime: ${timer.stop()}`);
            return;
        }

        console.log('\nNote: Actual preference removal will be implemented in a future step.\n');

        console.log(`✓ Total runtime: ${timer.stop()}`);
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
