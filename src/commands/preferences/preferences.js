import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import {
    findAllMatrixFiles,
    getAvailableRealms,
    getInstanceType,
    getRealmsByInstanceType
} from '../../helpers.js';
import { startTimer } from '../../helpers/timer.js';
import { getSiblingRepositories } from '../../helpers/util.js';
import {
    objectTypePrompt,
    scopePrompts,
    repositoryPrompt,
    includeDefaultsPrompt,
    resolveRealmScopeSelection,
    instanceTypePrompt,
    confirmPreferenceDeletionPrompt,
    runAnalyzePreferencesPrompt,
    useExistingBackupsForAllRealmsPrompt,
    realmPrompt
} from '../../commands/prompts/index.js';
import { LOG_PREFIX, SEPARATOR } from '../../config/constants.js';
import {
    logNoMatrixFiles,
    logMatrixFilesFound,
    logSummaryHeader,
    logRealmSummary,
    logSummaryFooter,
    logSectionTitle
} from '../../helpers/log.js';
import { processPreferenceMatrixFiles, executePreferenceSummarization, checkBackupStatusForRealms } from '../../helpers/preferenceHelper.js';
import {
    findAllActivePreferencesUsage,
    getActivePreferencesFromMatrices
} from '../../helpers/preferenceUsage.js';
import {
    loadPreferencesForDeletion,
    openPreferencesForDeletionInEditor,
    generateDeletionSummary
} from './helpers/preferenceRemoval.js';
import { loadBackupFile } from '../../helpers/preferenceBackup.js';
import { generate as generateSitePreferencesBackup } from './helpers/generateSitePreferences.js';
import { refreshMetadataBackupForRealm, getMetadataBackupPathForRealm } from '../../helpers/backupJob.js';
import { updateAttributeDefinitionById } from '../../api.js';
import { validateRealmsSelection } from './helpers/realmHelpers.js';
import { findLatestUsageCsv } from './helpers/csvHelpers.js';
import { findLatestBackupFile, validateAndCorrectBackup } from './helpers/backupHelpers.js';
import { restorePreferencesForRealm } from './helpers/restoreHelper.js';

// ============================================================================
// PREFERENCE COMMANDS REGISTRATION
// Register all preference-related commands with the CLI program
// ============================================================================

export function registerPreferenceCommands(program) {
    program
        .command('analyze-preferences')
        .description('Full preference analysis workflow: fetch -> summarize -> check')
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
                    logSectionTitle('BACKUP FILES FOUND');

                    validBackups.forEach(backup => {
                        console.log(`  ${LOG_PREFIX.INFO} ${backup.realm}: ${backup.ageInDays} day${backup.ageInDays === 1 ? '' : 's'} old`);
                    });

                    if (tooOldBackups.length > 0) {
                        console.log('\nBackups older than 14 days (will fetch fresh):');
                        tooOldBackups.forEach(backup => {
                            console.log(`  ${LOG_PREFIX.WARNING} ${backup.realm}: ${backup.ageInDays} days old`);
                        });
                    }

                    console.log('');

                    const backupAnswer = await inquirer.prompt(useExistingBackupsForAllRealmsPrompt({
                        availableCount: validBackups.length,
                        totalCount: realmsToProcess.length
                    }));

                    useCachedBackup = backupAnswer.useExisting;

                    if (useCachedBackup) {
                        console.log(`${LOG_PREFIX.INFO} Will use cached backups where available.\n`);
                    } else {
                        console.log(`${LOG_PREFIX.INFO} Will fetch fresh data for all realms.\n`);
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
                console.log(`\nOK Total runtime: ${timer.stop()}`);
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
                const firstRealmInstanceType = getInstanceType(realmsToProcess[0]);
                await findAllActivePreferencesUsage(repositoryPath, {
                    instanceTypeOverride: firstRealmInstanceType
                });
            }

            console.log(`\nOK Total runtime: ${timer.stop()}`);
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
                const msg = `Preferences for deletion file not found for instance type: ${instanceType}`;
                console.log(`\n${LOG_PREFIX.WARNING} ${msg}\n`);

                const analyzeAnswers = await inquirer.prompt(runAnalyzePreferencesPrompt(instanceType));

                if (!analyzeAnswers.runAnalyze) {
                    console.log(`\n${LOG_PREFIX.INFO} Preference removal cancelled.\n`);
                    console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
                    return;
                }

                console.log('\nRunning analyze-preferences command...\n');
                console.log(`${SEPARATOR}\n`);

                await new Promise((resolve, reject) => {
                    const analyzeProcess = spawn('node', ['src/main.js', 'analyze-preferences'], {
                        stdio: 'inherit',
                        shell: true
                    });

                    analyzeProcess.on('close', (code) => {
                        console.log(`\n${SEPARATOR}\n`);
                        if (code === 0) {
                            console.log(`${LOG_PREFIX.INFO} analyze-preferences completed successfully!\n`);
                            resolve();
                        } else {
                            reject(new Error(`analyze-preferences exited with code ${code}`));
                        }
                    });

                    analyzeProcess.on('error', (error) => {
                        reject(error);
                    });
                }).catch((error) => {
                    console.log(`\nERROR: ${error.message}`);
                    console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
                    return;
                });

                preferences = loadPreferencesForDeletion(instanceType);
                if (!preferences) {
                    console.log(`\n${LOG_PREFIX.WARNING} Preferences file still not found.`
                        + ' Please check the analyze-preferences output.\n');
                    console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
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
                console.log(`${LOG_PREFIX.INFO} Opened preferences file in VS Code: ${filePath}\n`);
            } catch (error) {
                console.log(`${LOG_PREFIX.WARNING} Could not open file in VS Code: ${error.message}`);
                console.log('  Make sure VS Code is installed and accessible via the "code" command.\n');
                console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
                return;
            }

            const summary = generateDeletionSummary(preferences);
            console.log('Top Preference Prefixes Being Removed:');
            summary.topPrefixes.forEach(([prefix, count]) => {
                const percentage = ((count / summary.total) * 100).toFixed(1);
                console.log(`  - ${prefix}: ${count} (${percentage}%)`);
            });
            console.log('');

            logSectionTitle('STEP 4: Select Realms to Process');

            const realmsForInstance = getRealmsByInstanceType(instanceType);
            if (!realmsForInstance || realmsForInstance.length === 0) {
                console.log(`No realms found for instance type: ${instanceType}`);
                console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
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
                console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
                return;
            }

            logSectionTitle('STEP 5: Create Backups (Per Realm)');

            const objectType = 'SitePreferences';

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

            if (realmsWithBackups.length > 0) {
                logSectionTitle('EXISTING BACKUP FILES FOUND');
                realmsWithBackups.forEach(realm => {
                    console.log(`  ${LOG_PREFIX.INFO} ${realm}: Backup exists for today's date`);
                });
                console.log('');
            }

            if (realmsWithoutBackups.length > 0) {
                console.log('Realms needing backup:');
                realmsWithoutBackups.forEach(realm => {
                    console.log(`  - ${realm}: No backup found, will create`);
                });
                console.log('');
            }

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
                    console.log(`${LOG_PREFIX.INFO} Will create new backups for all realms.\n`);
                    realmsToBackup = realmsToProcess;
                } else {
                    console.log(`${LOG_PREFIX.INFO} Will skip realms that already have backups.\n`);
                }
            }

            if (realmsToBackup.length === 0) {
                console.log('No realms need backup creation. All realms already have up-to-date backups.\n');
            } else {
                const refreshAnswers = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'refreshMetadata',
                        message: 'Trigger backup job and download latest metadata for realms needing backup?',
                        default: false
                    }
                ]);

                for (const realm of realmsToBackup) {
                    logSectionTitle(`Backup: ${realm} (${instanceType})`);

                    let metadataPath = getMetadataBackupPathForRealm(realm, instanceType);

                    if (refreshAnswers.refreshMetadata || !fs.existsSync(metadataPath)) {
                        console.log('STEP 5.1: Download Metadata Backup\n');
                        if (!fs.existsSync(metadataPath)) {
                            console.log(
                                `${LOG_PREFIX.WARNING} No existing metadata file found. Triggering backup job...\n`
                            );
                        }
                        console.log('Triggering backup job and downloading metadata...');
                        const refreshResult = await refreshMetadataBackupForRealm(realm, instanceType);

                        if (refreshResult.ok) {
                            metadataPath = refreshResult.filePath;
                            console.log(`${LOG_PREFIX.INFO} Downloaded metadata: ${refreshResult.filePath}\n`);
                        } else {
                            console.log(
                                `${LOG_PREFIX.WARNING} Failed to download metadata: ${refreshResult.reason}`
                            );
                            console.log('Cannot create backup without metadata. Skipping this realm.\n');
                            continue;
                        }
                    } else {
                        console.log('STEP 5.1: Using Existing Metadata\n');
                        console.log(`${LOG_PREFIX.INFO} Found metadata: ${metadataPath}\n`);
                    }

                    console.log('STEP 5.2: Generate Backup from CSV + Metadata\n');

                    const usageFilePath = findLatestUsageCsv(realm, instanceType);
                    if (usageFilePath) {
                        console.log(`Using usage CSV: ${path.basename(usageFilePath)}`);
                    } else {
                        console.log(
                            `${LOG_PREFIX.WARNING} No usage CSV found. Site values will not be included in backup.`
                        );
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
                        console.log(`${LOG_PREFIX.WARNING} Failed to create backup file: ${backupResult.error}`);
                        console.log('Skipping this realm.\n');
                        continue;
                    }

                    console.log(`${LOG_PREFIX.INFO} Backup created: ${backupResult.outputPath}`);
                    console.log(`   Total attributes: ${backupResult.stats.total}`);
                    console.log(`   Groups added: ${backupResult.stats.groups}`);
                    console.log(`   Preferences with site values: ${backupResult.stats.withValues}\n`);
                }
            }

            logSectionTitle('STEP 6: Confirm Deletion');

            console.log('Backup Summary:');
            console.log(`  - Realms processed: ${realmsToProcess.length}`);
            console.log(`  - Preferences backed up: ${preferences.length}`);
            console.log('  - Backup files ready for restore if needed\n');

            const confirmAnswers = await inquirer.prompt(confirmPreferenceDeletionPrompt(preferences.length));

            if (!confirmAnswers.confirm) {
                console.log(`\n${LOG_PREFIX.INFO} Preference removal cancelled.`);
                console.log(`${LOG_PREFIX.INFO} Backup files have been preserved for future use.\n`);
                console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
                return;
            }

            logSectionTitle('STEP 7: Remove Preferences');

            console.log(`Deleting ${preferences.length} preferences from ${realmsToProcess.length} realm(s)...\n`);

            let totalDeleted = 0;
            let totalFailed = 0;

            for (const realm of realmsToProcess) {
                console.log(`Processing realm: ${realm}\n`);

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
                        console.log(`  ${LOG_PREFIX.INFO} Deleted: ${preferenceId}`);
                    } else {
                        realmFailed++;
                        totalFailed++;
                        console.log(`  ${LOG_PREFIX.ERROR} Failed to delete: ${preferenceId}`);
                    }
                }

                console.log(`\n  Realm summary: ${realmDeleted} deleted, ${realmFailed} failed`);
                console.log('');
            }

            logSectionTitle('DELETION SUMMARY');
            console.log(`${LOG_PREFIX.INFO} Total preferences deleted: ${totalDeleted}`);
            console.log(`${LOG_PREFIX.ERROR} Total preferences failed: ${totalFailed}`);
            console.log(`  Realms processed: ${realmsToProcess.length}\n`);

            if (totalDeleted > 0) {
                console.log(`${LOG_PREFIX.INFO} Preferences successfully removed from SFCC.`);
                console.log('   Backup files are available for restore if needed.\n');
            } else if (totalFailed > 0) {
                console.log(`${LOG_PREFIX.WARNING} No preferences were deleted.`);
                console.log('   Check error messages above for details.\n');
            }

            console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);

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
                console.log(`\n${LOG_PREFIX.INFO} Restore skipped. Deleted preferences remain removed.\n`);
                return;
            }

            console.log('\nRestoring preferences from backups...\n');

            let totalRestored = 0;
            let totalRestoreFailed = 0;

            for (const realm of realmsToProcess) {
                console.log(`Restoring realm: ${realm}\n`);

                const backupDate = new Date().toISOString().split('T')[0];
                const backupFilePath = path.join(
                    process.cwd(),
                    'backup',
                    instanceType,
                    `${realm}_${objectType}_backup_${backupDate}.json`
                );

                if (!fs.existsSync(backupFilePath)) {
                    console.log(`${LOG_PREFIX.WARNING} Backup file not found at: ${backupFilePath}`);
                    console.log('   Skipping this realm...\n');
                    continue;
                }

                console.log(`Loading backup: ${path.basename(backupFilePath)}`);
                const backup = await loadBackupFile(backupFilePath);
                const result = await restorePreferencesForRealm({
                    preferenceIds: preferences, backup, objectType, instanceType, realm
                });

                totalRestored += result.restored;
                totalRestoreFailed += result.failed;
            }

            logSectionTitle('RESTORE SUMMARY');
            console.log(`${LOG_PREFIX.INFO} Total preferences restored: ${totalRestored}`);
            console.log(`${LOG_PREFIX.ERROR} Total restoration failures: ${totalRestoreFailed}`);
            console.log(`  Realms processed: ${realmsToProcess.length}\n`);

            if (totalRestored > 0) {
                console.log(`${LOG_PREFIX.INFO} Preferences successfully restored from backups.\n`);
            } else if (totalRestoreFailed > 0) {
                console.log(`${LOG_PREFIX.WARNING} Restoration encountered errors. Check messages above.\n`);
            }
        });

    program
        .command('restore-preferences')
        .description('Restore site preferences from backup file')
        .action(async () => {
            const timer = startTimer();
            logSectionTitle('Restore Preferences from Backup');

            const availableRealms = getAvailableRealms();
            if (availableRealms.length === 0) {
                console.log(`${LOG_PREFIX.WARNING} No realms configured. Run "add-realm" first.\n`);
                return;
            }

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

            console.log(`\nLooking for latest backup for realm: ${realm}\n`);

            const backupFilePath = findLatestBackupFile(realm, objectType);

            if (!backupFilePath || !fs.existsSync(backupFilePath)) {
                console.log(`${LOG_PREFIX.WARNING} No backup file found for realm: ${realm}`);
                console.log(`   Expected location: backup/${instanceType}/${realm}_${objectType}_backup_*.json\n`);
                console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
                return;
            }

            console.log(`${LOG_PREFIX.INFO} Found backup: ${path.basename(backupFilePath)}\n`);

            const confirmAnswers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'proceed',
                    message: 'Proceed with restoration?',
                    default: false
                }
            ]);

            if (!confirmAnswers.proceed) {
                console.log(`\n${LOG_PREFIX.INFO} Restore cancelled.\n`);
                console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
                return;
            }

            console.log('\nRestoring preferences from backup...\n');

            console.log('Loading backup file...');
            let backup = await loadBackupFile(backupFilePath);
            console.log(`${LOG_PREFIX.INFO} Loaded ${backup.attributes.length} preference(s)\n`);

            console.log('Validating backup structure...');
            const validation = validateAndCorrectBackup(backup);

            if (validation.corrected) {
                console.log(`${LOG_PREFIX.WARNING} Found issues in backup file:\n`);
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
                    console.log(`\n${LOG_PREFIX.INFO} Corrections applied to backup\n`);
                } else {
                    console.log(`\n${LOG_PREFIX.WARNING} Proceeding with original backup (may cause errors).\n`);
                }
            } else {
                console.log(`${LOG_PREFIX.INFO} Backup structure is valid\n`);
            }

            const preferences = backup.attributes.map(attr => attr.id);
            const result = await restorePreferencesForRealm({
                preferenceIds: preferences, backup, objectType, instanceType, realm
            });

            const totalRestored = result.restored;
            const totalRestoreFailed = result.failed;

            logSectionTitle('RESTORE SUMMARY');
            console.log(`${LOG_PREFIX.INFO} Total preferences restored: ${totalRestored}`);
            console.log(`${LOG_PREFIX.ERROR} Total restoration failures: ${totalRestoreFailed}`);
            console.log(`  Realm: ${realm}\n`);

            if (totalRestored > 0) {
                console.log(`${LOG_PREFIX.INFO} Preferences successfully restored from backup.\n`);
            } else if (totalRestoreFailed > 0) {
                console.log(`${LOG_PREFIX.WARNING} Restoration encountered errors. Check messages above.\n`);
            }

            console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
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
            console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
        });
}
