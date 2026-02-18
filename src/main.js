import inquirer from 'inquirer';
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { registerDebugCommands } from './debug.js';
import {
    addRealmToConfig,
    removeRealmFromConfig,
    findAllMatrixFiles,
    getAvailableRealms,
    getInstanceType,
    getRealmsByInstanceType
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
import { loadBackupFile, buildCreateSafeBody } from './helpers/preferenceBackup.js';
import { generate as generateSitePreferencesBackup } from './helpers/generateSitePreferencesJSON.js';
import { refreshMetadataBackupForRealm, getMetadataBackupPathForRealm } from './helpers/backupJob.js';
import { updateAttributeDefinitionById, assignAttributeToGroup, patchSitePreferencesGroup } from './api.js';

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

/**
 * Find the latest usage CSV file for a realm
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @returns {string|null} Path to latest usage CSV or null
 * @private
 */
function findLatestUsageCsv(realm, instanceType) {
    const realmDir = path.join(process.cwd(), 'results', instanceType, realm);
    if (!fs.existsSync(realmDir)) {
        return null;
    }

    const candidates = fs.readdirSync(realmDir)
        .filter(name => name.endsWith('_preferences_usage.csv'))
        .map(name => path.join(realmDir, name));

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return candidates[0];
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
                useCachedBackup,
                repositoryPath
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

        const preferencesFilePath = path.join(
            process.cwd(),
            'results',
            instanceType,
            'ALL_REALMS',
            `${instanceType}_preferences_for_deletion.txt`
        );

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

        logSectionTitle('STEP 4: Select Realms to Process');

        const realmsForInstance = getRealmsByInstanceType(instanceType);
        if (!realmsForInstance || realmsForInstance.length === 0) {
            console.log(`No realms found for instance type: ${instanceType}`);
            console.log(`✓ Total runtime: ${timer.stop()}`);
            return;
        }

        const realmSelection = await inquirer.prompt([
            {
                name: 'realms',
                message: 'Select realms to process:',
                type: 'checkbox',
                choices: realmsForInstance,
                default: realmsForInstance
            }
        ]);

        const realmsToProcess = realmSelection.realms;
        if (!realmsToProcess || realmsToProcess.length === 0) {
            console.log('No realms selected.');
            console.log(`✓ Total runtime: ${timer.stop()}`);
            return;
        }

        logSectionTitle('STEP 5: Create Backups (Per Realm)');

        const objectType = 'SitePreferences';

        // First, check which realms already have backups for today
        const realmsWithBackups = [];
        const realmsWithoutBackups = [];

        for (const realm of realmsToProcess) {
            const backupDate = new Date().toISOString().split('T')[0];
            const backupFilePath = path.join(
                process.cwd(),
                'backup',
                instanceType,
                `${realm}_${objectType}_backup_${backupDate}.json`
            );

            if (fs.existsSync(backupFilePath)) {
                realmsWithBackups.push(realm);
            } else {
                realmsWithoutBackups.push(realm);
            }
        }

        // Show backup status
        if (realmsWithBackups.length > 0) {
            console.log('\n================================================================================');
            console.log('EXISTING BACKUP FILES FOUND');
            console.log('================================================================================\n');
            realmsWithBackups.forEach(realm => {
                console.log(`  ✓ ${realm}: Backup exists for today's date`);
            });
            console.log('');
        }

        if (realmsWithoutBackups.length > 0) {
            console.log('Realms needing backup:');
            realmsWithoutBackups.forEach(realm => {
                console.log(`  • ${realm}: No backup found, will create`);
            });
            console.log('');
        }

        // Determine which realms to create backups for
        let realmsToBackup = realmsWithoutBackups;

        if (realmsWithBackups.length > 0) {
            const overwriteAnswers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'createNew',
                    message: realmsWithBackups.length + ' realm(s) already have backup files. Create new ones anyway?',
                    default: false
                }
            ]);

            if (overwriteAnswers.createNew) {
                console.log('✓ Will create new backups for all realms.\n');
                realmsToBackup = realmsToProcess;
            } else {
                console.log('✓ Will skip realms that already have backups.\n');
            }
        }

        if (realmsToBackup.length === 0) {
            console.log('No realms need backup creation. All realms already have up-to-date backups.\n');
        } else {
            // Ask about metadata refresh only if we're creating backups
            const refreshAnswers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'refreshMetadata',
                    message: 'Trigger backup job and download latest metadata for realms needing backup?',
                    default: false
                }
            ]);

            for (const realm of realmsToBackup) {
                console.log('\n================================================================================');
                console.log(`Realm: ${realm}`);
                console.log(`Instance type: ${instanceType}`);
                console.log('================================================================================\n');

                let metadataPath = getMetadataBackupPathForRealm(realm, instanceType);

                if (refreshAnswers.refreshMetadata || !fs.existsSync(metadataPath)) {
                    console.log('📎 STEP 5.1: Download Metadata Backup\n');
                    if (!fs.existsSync(metadataPath)) {
                        console.log('⚠ No existing metadata file found. Triggering backup job...\n');
                    }
                    console.log('Triggering backup job and downloading metadata...');
                    const refreshResult = await refreshMetadataBackupForRealm(realm, instanceType);

                    if (refreshResult.ok) {
                        metadataPath = refreshResult.filePath;
                        console.log(`✓ Downloaded metadata: ${refreshResult.filePath}\n`);
                    } else {
                        console.log(`⚠ Failed to download metadata: ${refreshResult.reason}`);
                        console.log('Cannot create backup without metadata. Skipping this realm.\n');
                        continue;
                    }
                } else {
                    console.log('📎 STEP 5.1: Using Existing Metadata\n');
                    console.log(`✓ Found metadata: ${metadataPath}\n`);
                }

                console.log('📋 STEP 5.2: Generate Backup from CSV + Metadata\n');

                const usageFilePath = findLatestUsageCsv(realm, instanceType);
                if (usageFilePath) {
                    console.log(`Using usage CSV: ${path.basename(usageFilePath)}`);
                } else {
                    console.log('⚠️  No usage CSV found. Site values will not be included in backup.');
                }

                const backupDir = path.join(process.cwd(), 'backup', instanceType);
                if (!fs.existsSync(backupDir)) {
                    fs.mkdirSync(backupDir, { recursive: true });
                }

                const backupDate = new Date().toISOString().split('T')[0];
                const backupFilePath = path.join(
                    backupDir,
                    `${realm}_${objectType}_backup_${backupDate}.json`
                );

                const backupResult = await generateSitePreferencesBackup({
                    unusedPreferencesFile: preferencesFilePath,
                    csvFile: usageFilePath,
                    xmlMetadataFile: metadataPath,
                    outputFile: backupFilePath,
                    realm,
                    instanceType,
                    objectType,
                    verbose: true
                });

                if (!backupResult.success) {
                    console.log(`⚠ Failed to create backup file: ${backupResult.error}`);
                    console.log('Skipping this realm.\n');
                    continue;
                }

                console.log(`✓ Backup created: ${backupResult.outputPath}`);
                console.log(`   Total attributes: ${backupResult.stats.total}`);
                console.log(`   Groups added: ${backupResult.stats.groups}`);
                console.log(`   Preferences with site values: ${backupResult.stats.withValues}\n`);
            }
        }

        logSectionTitle('STEP 6: Confirm Deletion');

        console.log('Backup Summary:');
        console.log(`  • Realms processed: ${realmsToProcess.length}`);
        console.log(`  • Preferences backed up: ${preferences.length}`);
        console.log('  • Backup files ready for restore if needed\n');

        const confirmAnswers = await inquirer.prompt(confirmPreferenceDeletionPrompt(preferences.length));

        if (!confirmAnswers.confirm) {
            console.log('\n✓ Preference removal cancelled.');
            console.log('✓ Backup files have been preserved for future use.\n');
            console.log(`✓ Total runtime: ${timer.stop()}`);
            return;
        }

        logSectionTitle('STEP 7: Remove Preferences');

        console.log(`Deleting ${preferences.length} preferences from ${realmsToProcess.length} realm(s)...\n`);

        let totalDeleted = 0;
        let totalFailed = 0;

        for (const realm of realmsToProcess) {
            console.log(`📎 Processing realm: ${realm}\n`);

            let realmDeleted = 0;
            let realmFailed = 0;

            for (const preferenceId of preferences) {
                const result = await updateAttributeDefinitionById(
                    objectType,
                    preferenceId,
                    'delete',
                    null,
                    realm
                );

                if (result || result === true) {
                    realmDeleted++;
                    totalDeleted++;
                    console.log(`  ✓ Deleted: ${preferenceId}`);
                } else {
                    realmFailed++;
                    totalFailed++;
                    console.log(`  ✗ Failed to delete: ${preferenceId}`);
                }
            }

            console.log(`\n  Realm summary: ${realmDeleted} deleted, ${realmFailed} failed`);
            console.log('');
        }

        console.log('================================================================================');
        console.log('DELETION SUMMARY');
        console.log('================================================================================\n');
        console.log(`✓ Total preferences deleted: ${totalDeleted}`);
        console.log(`✗ Total preferences failed: ${totalFailed}`);
        console.log(`  Realms processed: ${realmsToProcess.length}\n`);

        if (totalDeleted > 0) {
            console.log('✅ Preferences successfully removed from SFCC.');
            console.log('   Backup files are available for restore if needed.\n');
        } else if (totalFailed > 0) {
            console.log('⚠️  No preferences were deleted.');
            console.log('   Check error messages above for details.\n');
        }

        console.log(`✓ Total runtime: ${timer.stop()}`);

        // STEP 8: Restore from Backups
        logSectionTitle('STEP 8: Restore from Backups (Optional)');

        const restoreAnswers = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'restore',
                message: 'Would you like to restore the preferences from backups?',
                default: false
            }
        ]);

        if (!restoreAnswers.restore) {
            console.log('\n✓ Restore skipped. Deleted preferences remain removed.\n');
            return;
        }

        console.log('\nRestoring preferences from backups...\n');

        let totalRestored = 0;
        let totalRestoreFailed = 0;

        for (const realm of realmsToProcess) {
            console.log(`📎 Restoring realm: ${realm}\n`);

            const backupDate = new Date().toISOString().split('T')[0];
            const backupFilePath = path.join(
                process.cwd(),
                'backup',
                instanceType,
                `${realm}_${objectType}_backup_${backupDate}.json`
            );

            if (!fs.existsSync(backupFilePath)) {
                console.log(`⚠️  Backup file not found at: ${backupFilePath}`);
                console.log('   Skipping this realm...\n');
                continue;
            }

            console.log(`Loading backup: ${path.basename(backupFilePath)}`);
            const backup = await loadBackupFile(backupFilePath);

            let realmRestored = 0;
            let realmRestoreFailed = 0;

            // Restore each preference
            for (const preferenceId of preferences) {
                const attributeToRestore = backup.attributes.find(attr => attr.id === preferenceId);

                if (!attributeToRestore) {
                    console.log(`  ⚠️  ${preferenceId} not found in backup. Skipping...`);
                    realmRestoreFailed++;
                    continue;
                }

                // Restore attribute definition (filtered to safe fields only)
                const safeRestoreBody = buildCreateSafeBody(attributeToRestore);
                const restored = await updateAttributeDefinitionById(
                    objectType,
                    preferenceId,
                    'put',
                    safeRestoreBody,
                    realm
                );

                if (!restored) {
                    realmRestoreFailed++;
                    totalRestoreFailed++;
                    console.log(`  ✗ Failed to restore: ${preferenceId}`);
                    continue;
                }

                realmRestored++;
                totalRestored++;
                console.log(`  ✓ Restored: ${preferenceId}`);

                // Restore group membership
                const groupsToRestore = backup.attribute_groups.filter(group =>
                    group.attributes.includes(preferenceId)
                );

                for (const group of groupsToRestore) {
                    const assigned = await assignAttributeToGroup(
                        objectType,
                        group.group_id,
                        preferenceId,
                        realm
                    );
                    if (assigned) {
                        console.log(`    ✓ Assigned to group: ${group.group_id}`);
                    } else {
                        console.log(`    ✗ Failed to assign to group: ${group.group_id}`);
                    }
                }

                // Restore site values
                const siteValueData = backup.site_values?.[preferenceId];

                if (siteValueData && siteValueData.siteValues && Object.keys(siteValueData.siteValues).length > 0) {
                    const { groupId: groupId, siteValues: siteValues } = siteValueData;
                    const attributeKey = preferenceId.startsWith('c_') ? preferenceId : `c_${preferenceId}`;

                    for (const [siteId, value] of Object.entries(siteValues)) {
                        const payload = {
                            [attributeKey]: value
                        };
                        const result = await patchSitePreferencesGroup(
                            siteId,
                            groupId,
                            instanceType,
                            payload,
                            realm
                        );
                        if (result) {
                            console.log(`    ✓ Restored value for ${siteId}: "${value}"`);
                        } else {
                            console.log(`    ✗ Failed to restore value for ${siteId}`);
                        }
                    }
                }
            }

            console.log(`\n  Realm summary: ${realmRestored} restored, ${realmRestoreFailed} failed\n`);
        }

        console.log('================================================================================');
        console.log('RESTORE SUMMARY');
        console.log('================================================================================\n');
        console.log(`✓ Total preferences restored: ${totalRestored}`);
        console.log(`✗ Total restoration failures: ${totalRestoreFailed}`);
        console.log(`  Realms processed: ${realmsToProcess.length}\n`);

        if (totalRestored > 0) {
            console.log('✅ Preferences successfully restored from backups.\n');
        } else if (totalRestoreFailed > 0) {
            console.log('⚠️  Restoration encountered errors. Check messages above.\n');
        }
    });

program
    .command('backup-site-preferences')
    .description('Trigger site preferences backup job and download the ZIP from WebDAV')
    .action(async () => {
        const timer = startTimer();
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const realm = realmAnswers.realm;
        const instanceType = getInstanceType(realm);

        console.log('Triggering backup job and downloading metadata...');
        const refreshResult = await refreshMetadataBackupForRealm(realm, instanceType);

        if (!refreshResult.ok) {
            console.log(`Failed to refresh metadata: ${refreshResult.reason}`);
            return;
        }

        console.log(`Backup downloaded to: ${refreshResult.filePath}`);
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
// RESTORE PREFERENCES COMMAND
// Restore preferences from backup files
// ============================================================================

/**
 * Find the latest backup file for a given realm
 * @param {string} realm - Realm name
 * @param {string} objectType - Object type (default: SitePreferences)
 * @returns {string|null} Path to latest backup file or null if not found
 * @private
 */
function findLatestBackupFile(realm, objectType = 'SitePreferences') {
    const instanceType = getInstanceType(realm);
    const backupDir = path.join(process.cwd(), 'backup', instanceType);
    
    if (!fs.existsSync(backupDir)) {
        return null;
    }
    
    const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(`${realm}_${objectType}_backup_`) && f.endsWith('.json'))
        .sort()
        .reverse(); // Sort descending to get latest first
    
    return files.length > 0
        ? path.join(backupDir, files[0])
        : null;
}

/**
 * Validate and correct backup attribute definitions
 * Ensures all fields are in proper OCAPI format (objects for localized fields, etc)
 * @param {Object} backup - Backup object
 * @returns {Object} {corrected: boolean, corrections: string[], backup: correctedBackup}
 * @private
 */
function validateAndCorrectBackup(backup) {
    const corrections = [];
    const correctedBackup = JSON.parse(JSON.stringify(backup)); // Deep clone
    
    for (let i = 0; i < correctedBackup.attributes.length; i++) {
        const attr = correctedBackup.attributes[i];
        
        // Check display_name
        if (attr.display_name && typeof attr.display_name === 'string') {
            corrections.push(`  • Fixed display_name for "${attr.id}": string → object`);
            attr.display_name = { default: attr.display_name };
        }
        
        // Check description
        if (attr.description) {
            if (typeof attr.description === 'string') {
                corrections.push(`  • Fixed description for "${attr.id}": string → object`);
                attr.description = { default: attr.description };
            } else if (typeof attr.description === 'object' && (attr.description._ || attr.description.$)) {
                // Remove xml2js artifacts
                const cleanDesc = {};
                const descriptions = attr.description._
                    ? { default: attr.description._ }
                    : attr.description;
                Object.keys(descriptions).forEach(key => {
                    if (key !== '_' && key !== '$') {
                        cleanDesc[key] = descriptions[key];
                    }
                });
                if (Object.keys(cleanDesc).length > 0) {
                    corrections.push(`  • Cleaned description for "${attr.id}": removed xml2js artifacts`);
                    attr.description = cleanDesc;
                } else {
                    attr.description = null;
                }
            }
        }

        // Check default_value - should be {value: <typedValue>}
        if (attr.default_value) {
            let needsFix = false;
            let typedValue = attr.default_value;

            if (typeof attr.default_value === 'string') {
                // Convert string to typed value based on value_type
                needsFix = true;
                const valueType = attr.value_type;
                if (valueType === 'int' || valueType === 'integer') {
                    typedValue = parseInt(attr.default_value, 10);
                } else if (valueType === 'double' || valueType === 'decimal') {
                    typedValue = parseFloat(attr.default_value);
                } else if (valueType === 'boolean') {
                    typedValue = attr.default_value === 'true' || attr.default_value === true;
                }
                // else keep as string for string type
                attr.default_value = { value: typedValue };
            } else if (typeof attr.default_value === 'object') {
                // Check if it has wrong structure (with _ or $ or using 'default' key)
                if (attr.default_value._ || attr.default_value.$ || ('default' in attr.default_value && !('value' in attr.default_value))) {
                    needsFix = true;
                    // Extract the raw value
                    let rawValue = attr.default_value._ || attr.default_value.default || Object.values(attr.default_value).find(v => typeof v !== 'object') || null;
                    if (rawValue !== null) {
                        // Convert based on value type
                        const valueType = attr.value_type;
                        if (valueType === 'int' || valueType === 'integer') {
                            typedValue = parseInt(rawValue, 10);
                        } else if (valueType === 'double' || valueType === 'decimal') {
                            typedValue = parseFloat(rawValue);
                        } else if (valueType === 'boolean') {
                            typedValue = rawValue === 'true' || rawValue === true;
                        } else {
                            typedValue = rawValue;
                        }
                        attr.default_value = { value: typedValue };
                    } else {
                        attr.default_value = null;
                    }
                }
            }

            if (needsFix) {
                corrections.push(`  • Fixed default_value for "${attr.id}": converted to {value: <typed>}`);
            }
        }

        // Clean any lingering xml2js artifacts
        const xmljsKeys = Object.keys(attr).filter(k => k === '_' || k === '$');
        if (xmljsKeys.length > 0) {
            corrections.push(`  • Removed xml2js artifacts from "${attr.id}"`);
            xmljsKeys.forEach(k => delete attr[k]);
        }
    }
    
    return {
        corrected: corrections.length > 0,
        corrections,
        backup: correctedBackup
    };
}


program
    .command('restore-preferences')
    .description('Restore site preferences from backup file')
    .action(async () => {
        const timer = startTimer();
        logSectionTitle('Restore Preferences from Backup');

        // Get available realms
        const availableRealms = getAvailableRealms();
        if (availableRealms.length === 0) {
            console.log('⚠️  No realms configured. Run "add-realm" first.\n');
            return;
        }

        // Prompt for realm selection
        const realmAnswers = await inquirer.prompt([
            {
                type: 'list',
                name: 'realm',
                message: 'Select realm to restore:',
                choices: availableRealms
            }
        ]);

        const realm = realmAnswers.realm;
        const objectType = 'SitePreferences';
        const instanceType = getInstanceType(realm);

        console.log(`\n📎 Looking for latest backup for realm: ${realm}\n`);

        // Find latest backup file
        const backupFilePath = findLatestBackupFile(realm, objectType);

        if (!backupFilePath || !fs.existsSync(backupFilePath)) {
            console.log(`⚠️  No backup file found for realm: ${realm}`);
            console.log(`   Expected location: backup/${instanceType}/${realm}_${objectType}_backup_*.json\n`);
            console.log(`✓ Total runtime: ${timer.stop()}`);
            return;
        }

        console.log(`✓ Found backup: ${path.basename(backupFilePath)}\n`);

        // Confirm restore
        const confirmAnswers = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'proceed',
                message: 'Proceed with restoration?',
                default: false
            }
        ]);

        if (!confirmAnswers.proceed) {
            console.log('\n✓ Restore cancelled.\n');
            console.log(`✓ Total runtime: ${timer.stop()}`);
            return;
        }

        console.log('\nRestoring preferences from backup...\n');

        // Load backup
        console.log('Loading backup file...');
        let backup = await loadBackupFile(backupFilePath);
        console.log(`✓ Loaded ${backup.attributes.length} preference(s)\n`);

        // Validate and correct backup
        console.log('Validating backup structure...');
        const validation = validateAndCorrectBackup(backup);
        
        if (validation.corrected) {
            console.log('⚠️  Found issues in backup file:\n');
            validation.corrections.forEach(msg => console.log(msg));
            
            const correctAnswers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'applyCorrections',
                    message: '\nApply these corrections before restore?',
                    default: true
                }
            ]);

            if (correctAnswers.applyCorrections) {
                backup = validation.backup;
                console.log('\n✓ Corrections applied to backup\n');
            } else {
                console.log('\n⚠️  Proceeding with original backup (may cause errors).\n');
            }
        } else {
            console.log('✓ Backup structure is valid\n');
        }

        const preferences = backup.attributes.map(attr => attr.id);
        let totalRestored = 0;
        let totalRestoreFailed = 0;

        // Restore each preference
        for (const preferenceId of preferences) {
            const attributeToRestore = backup.attributes.find(attr => attr.id === preferenceId);

            if (!attributeToRestore) {
                console.log(`  ⚠️  ${preferenceId} not found in backup. Skipping...`);
                totalRestoreFailed++;
                continue;
            }

            // Restore attribute definition (filtered to safe fields only)
            const safeRestoreBody = buildCreateSafeBody(attributeToRestore);
            const restored = await updateAttributeDefinitionById(
                objectType,
                preferenceId,
                'put',
                safeRestoreBody,
                realm
            );

            if (!restored) {
                totalRestoreFailed++;
                console.log(`  ✗ Failed to restore: ${preferenceId}`);
                continue;
            }

            totalRestored++;
            console.log(`  ✓ Restored: ${preferenceId}`);

            // Restore group membership
            const groupsToRestore = backup.attribute_groups.filter(group =>
                group.attributes.includes(preferenceId)
            );

            for (const group of groupsToRestore) {
                const assigned = await assignAttributeToGroup(
                    objectType,
                    group.group_id,
                    preferenceId,
                    realm
                );
                if (assigned) {
                    console.log(`    ✓ Assigned to group: ${group.group_id}`);
                } else {
                    console.log(`    ✗ Failed to assign to group: ${group.group_id}`);
                }
            }

            // Restore site values
            const siteValueData = backup.site_values?.[preferenceId];

            if (siteValueData && siteValueData.siteValues && Object.keys(siteValueData.siteValues).length > 0) {
                const { groupId: groupId, siteValues: siteValues } = siteValueData;
                const attributeKey = preferenceId.startsWith('c_') ? preferenceId : `c_${preferenceId}`;

                for (const [siteId, value] of Object.entries(siteValues)) {
                    const payload = {
                        [attributeKey]: value
                    };
                    const result = await patchSitePreferencesGroup(
                        siteId,
                        groupId,
                        instanceType,
                        payload,
                        realm
                    );
                    if (result) {
                        console.log(`    ✓ Restored value for ${siteId}: "${value}"`);
                    } else {
                        console.log(`    ✗ Failed to restore value for ${siteId}`);
                    }
                }
            }
        }

        console.log('\n================================================================================');
        console.log('RESTORE SUMMARY');
        console.log('================================================================================\n');
        console.log(`✓ Total preferences restored: ${totalRestored}`);
        console.log(`✗ Total restoration failures: ${totalRestoreFailed}`);
        console.log(`  Realm: ${realm}\n`);

        if (totalRestored > 0) {
            console.log('✅ Preferences successfully restored from backup.\n');
        } else if (totalRestoreFailed > 0) {
            console.log('⚠️  Restoration encountered errors. Check messages above.\n');
        }

        console.log(`✓ Total runtime: ${timer.stop()}`);
    });

// ============================================================================
// REGISTER DEBUG COMMANDS
// ============================================================================

registerDebugCommands(program);

program.parse();
