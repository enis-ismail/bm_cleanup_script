import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import {
    findAllMatrixFiles,
    getSiblingRepositories
} from '../../io/util.js';
import {
    getAvailableRealms,
    getInstanceType,
    getRealmsByInstanceType,
    getSandboxConfig
} from '../../config/helpers/helpers.js';
import { startTimer } from '../../helpers/timer.js';
import { RealmProgressDisplay } from '../../scripts/loggingScript/progressDisplay.js';
import {
    objectTypePrompt,
    scopePrompts,
    repositoryPrompt,
    includeDefaultsPrompt,
    resolveRealmScopeSelection,
    instanceTypePrompt,
    confirmPreferenceDeletionPrompt,
    runAnalyzePreferencesPrompt,
    realmPrompt,
    promptBackupCachePreference
} from '../../commands/prompts/index.js';
import { LOG_PREFIX, DIRECTORIES, IDENTIFIERS, FILE_PATTERNS } from '../../config/constants.js';
import {
    logNoMatrixFiles,
    logMatrixFilesFound,
    logSummaryHeader,
    logRealmSummary,
    logSummaryFooter,
    logSectionTitle,
    logRuntime,
    logDeletionSummary,
    logRestoreSummary,
    logBackupClassification
} from '../../scripts/loggingScript/log.js';
import {
    processPreferenceMatrixFiles,
    executePreferenceSummarization
} from '../../helpers/analyzer.js';
import {
    findAllActivePreferencesUsage,
    getActivePreferencesFromMatrices
} from '../../io/codeScanner.js';
import {
    loadPreferencesForDeletion,
    openPreferencesForDeletionInEditor,
    generateDeletionSummary
} from './helpers/preferenceRemoval.js';
import { loadBackupFile } from '../../io/backupUtils.js';
import { refreshMetadataBackupForRealm } from '../../helpers/backupJob.js';
import { validateRealmsSelection } from './helpers/realmHelpers.js';
import {
    findLatestBackupFile,
    validateAndCorrectBackup,
    createBackupsForRealms
} from './helpers/backupHelpers.js';
import {
    runAnalyzePreferencesSubprocess,
    deletePreferencesForRealms,
    restorePreferencesFromBackups,
    classifyRealmBackupStatus
} from './helpers/deleteHelpers.js';
import { restorePreferencesForRealm } from './helpers/restoreHelper.js';

// ============================================================================
// PREFERENCE COMMANDS REGISTRATION
// Register all preference-related commands with the CLI program
// ============================================================================

export function registerPreferenceCommands(program) {
    program
        .command('analyze-preferences')
        .description('Full preference analysis workflow: fetch -> summarize -> check')
        .action(analyzePreferences);

    program
        .command('remove-preferences')
        .description('Remove preferences marked for deletion from site preferences')
        .action(removePreferences);

    program
        .command('restore-preferences')
        .description('Restore site preferences from backup file')
        .action(restorePreferences);

    program
        .command('backup-site-preferences')
        .description('Trigger site preferences backup job and download the ZIP from WebDAV')
        .action(backupSitePreferences);
}

// ============================================================================
// ANALYZE PREFERENCES
// Full workflow: fetch -> summarize -> check usage in cartridges
// ============================================================================

async function analyzePreferences() {
    const timer = startTimer();

    // --- STEP 1: Configure Scope & Options ---
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
        ...objectTypePrompt(IDENTIFIERS.SITE_PREFERENCES),
        ...scopePrompts(),
        ...includeDefaultsPrompt()
    ]);

    const { objectType, scope, siteId, includeDefaults } = answers;

    const useCachedBackup = includeDefaults
        ? await promptBackupCachePreference(realmsToProcess, objectType)
        : false;

    // --- STEP 2: Fetch & Summarize ---
    logSectionTitle('STEP 2: Fetching & Summarizing Preferences');

    const progressDisplay = new RealmProgressDisplay(250);
    progressDisplay.start();

    try {
        for (const realm of realmsToProcess) {
            const realmConfig = getSandboxConfig(realm);
            const realmHostname = realmConfig.hostname;

            try {
                await executePreferenceSummarization(
                    {
                        realm,
                        objectType,
                        instanceType: getInstanceType(realm),
                        scope,
                        siteId,
                        includeDefaults,
                        useCachedBackup,
                        repositoryPath
                    },
                    {
                        display: progressDisplay,
                        hostname: realmHostname,
                        realmName: realm
                    }
                );
            } catch (realmError) {
                progressDisplay.failStep(realmHostname, 'fetch');
                console.error(`Error processing realm ${realm}:`, realmError.message);
                throw realmError;
            }
        }
    } finally {
        progressDisplay.finish();
    }

    console.log('');

    // --- STEP 3: Check Preference Usage ---
    logSectionTitle('STEP 3: Checking Preference Usage');

    const matrixFiles = findAllMatrixFiles(realmsToProcess);

    if (matrixFiles.length === 0) {
        logNoMatrixFiles();
        console.log('');
        logRuntime(timer);
        return;
    }

    logMatrixFilesFound(matrixFiles.length);

    const summary = await processPreferenceMatrixFiles(matrixFiles);

    logSummaryHeader();
    for (const stats of summary) {
        logRealmSummary(stats);
    }
    logSummaryFooter();

    // --- STEP 4: Active Preferences Summary ---
    logSectionTitle('STEP 4: Active Preferences Summary');

    const matrixFilePaths = matrixFiles.map(f => f.matrixFile);
    const activePreferences = Array.from(getActivePreferencesFromMatrices(matrixFilePaths)).sort();
    console.log(`Active Preferences (${activePreferences.length}):\n`);

    // --- STEP 5: Find Preference Usage in Cartridges ---
    logSectionTitle('STEP 5: Finding Preference Usage in Cartridges');

    if (repositoryPath && realmsToProcess.length > 0) {
        const firstRealmInstanceType = getInstanceType(realmsToProcess[0]);
        const repoName = path.basename(repositoryPath);
        
        let scanStep = null;
        if (progressDisplay) {
            scanStep = `scan_${Date.now()}`;
            progressDisplay.startStep('codeScanner', 'Code Scanner', scanStep, `Scanning ${repoName} for references`);
            progressDisplay.start();
        }
        
        const scanCallback = (scannedCount, totalFiles) => {
            if (progressDisplay && scanStep) {
                const percentage = Math.round((scannedCount / totalFiles) * 100);
                progressDisplay.setStepProgress('codeScanner', scanStep, percentage);
                progressDisplay.setStepMessage('codeScanner', scanStep, `${scannedCount}/${totalFiles} files`, 'info');
            }
        };
        
        try {
            await findAllActivePreferencesUsage(repositoryPath, {
                instanceTypeOverride: firstRealmInstanceType,
                progressCallback: scanCallback,
                realmFilter: realmsToProcess
            });
            
            if (progressDisplay && scanStep) {
                progressDisplay.completeStep('codeScanner', scanStep);
            }
        } finally {
            if (progressDisplay) {
                progressDisplay.finish();
            }
        }
    }

    console.log('');
    logRuntime(timer);
}

// ============================================================================
// REMOVE PREFERENCES
// Load deletion list -> backup -> delete -> optional restore
// ============================================================================

async function removePreferences() {
    const timer = startTimer();

    // --- STEP 1: Select Instance Type ---
    logSectionTitle('STEP 1: Select Instance Type');
    const { instanceType } = await inquirer.prompt(instanceTypePrompt('development'));

    // --- STEP 2: Load Preferences for Deletion ---
    logSectionTitle('STEP 2: Load Preferences for Deletion');
    const preferences = await loadOrGenerateDeletionList(instanceType, timer);
    if (!preferences) {
        return;
    }

    // --- STEP 3: Review Preferences for Deletion ---
    logSectionTitle('STEP 3: Review Preferences for Deletion');
    if (!await reviewPreferencesInEditor(instanceType, timer)) {
        return;
    }
    logDeletionPrefixSummary(preferences);

    // --- STEP 4: Select Realms to Process ---
    logSectionTitle('STEP 4: Select Realms to Process');
    const realmsToProcess = await selectRealmsForInstance(instanceType);
    if (!realmsToProcess) {
        logRuntime(timer);
        return;
    }

    // --- STEP 5: Create Backups ---
    logSectionTitle('STEP 5: Create Backups (Per Realm)');
    const objectType = IDENTIFIERS.SITE_PREFERENCES;
    const preferencesFilePath = getDeletionFilePath(instanceType);
    const backupsReady = await handleBackupCreation(
        realmsToProcess, objectType, instanceType, preferencesFilePath
    );

    if (!backupsReady) {
        logRuntime(timer);
        return;
    }

    // --- STEP 6: Confirm Deletion ---
    logSectionTitle('STEP 6: Confirm Deletion');
    console.log('Backup Summary:');
    console.log(`  - Realms processed: ${realmsToProcess.length}`);
    console.log(`  - Preferences backed up: ${preferences.length}`);
    console.log('  - Backup files ready for restore if needed\n');

    const confirmAnswers = await inquirer.prompt(confirmPreferenceDeletionPrompt(preferences.length));
    if (!confirmAnswers.confirm) {
        console.log(`\n${LOG_PREFIX.INFO} Preference removal cancelled.`);
        console.log(`${LOG_PREFIX.INFO} Backup files have been preserved for future use.\n`);
        logRuntime(timer);
        return;
    }

    // --- STEP 7: Delete Preferences ---
    logSectionTitle('STEP 7: Remove Preferences');
    const { totalDeleted, totalFailed } = await deletePreferencesForRealms({
        realmsToProcess, preferences, objectType
    });
    logDeletionSummary({ deleted: totalDeleted, failed: totalFailed, realms: realmsToProcess.length });
    logRuntime(timer);

    // --- STEP 8: Optional Restore ---
    logSectionTitle('STEP 8: Restore from Backups (Optional)');
    const restoreAnswers = await inquirer.prompt([{
        type: 'confirm',
        name: 'restore',
        message: 'Would you like to restore the preferences from backups?',
        default: false
    }]);

    if (!restoreAnswers.restore) {
        console.log(`\n${LOG_PREFIX.INFO} Restore skipped. Deleted preferences remain removed.\n`);
        return;
    }

    const { totalRestored, totalFailed: restoreFailed } = await restorePreferencesFromBackups({
        realmsToProcess, preferences, objectType, instanceType
    });
    logRestoreSummary({ restored: totalRestored, failed: restoreFailed, realm: realmsToProcess.length });
}

// ============================================================================
// RESTORE PREFERENCES
// Standalone restore from backup file
// ============================================================================

async function restorePreferences() {
    const timer = startTimer();
    logSectionTitle('Restore Preferences from Backup');

    const availableRealms = getAvailableRealms();
    if (availableRealms.length === 0) {
        console.log(`${LOG_PREFIX.WARNING} No realms configured. Run "add-realm" first.\n`);
        return;
    }

    const realmAnswers = await inquirer.prompt([{
        type: 'list',
        name: 'realm',
        message: 'Select realm to restore:',
        choices: availableRealms
    }]);

    const realm = realmAnswers.realm;
    const objectType = IDENTIFIERS.SITE_PREFERENCES;
    const instanceType = getInstanceType(realm);

    console.log(`\nLooking for latest backup for realm: ${realm}\n`);

    const backupFilePath = findLatestBackupFile(realm, objectType);
    if (!backupFilePath || !fs.existsSync(backupFilePath)) {
        console.log(`${LOG_PREFIX.WARNING} No backup file found for realm: ${realm}`);
        console.log(
            `   Expected location: backup/${instanceType}/${realm}_${objectType}_backup_*.json\n`
        );
        logRuntime(timer);
        return;
    }

    console.log(`${LOG_PREFIX.INFO} Found backup: ${path.basename(backupFilePath)}\n`);

    const confirmAnswers = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: 'Proceed with restoration?',
        default: false
    }]);

    if (!confirmAnswers.proceed) {
        console.log(`\n${LOG_PREFIX.INFO} Restore cancelled.\n`);
        logRuntime(timer);
        return;
    }

    console.log('\nRestoring preferences from backup...\n');

    const backup = await loadAndValidateBackup(backupFilePath);
    if (!backup) {
        return;
    }

    const preferences = backup.attributes.map(attr => attr.id);
    const result = await restorePreferencesForRealm({
        preferenceIds: preferences, backup, objectType, instanceType, realm
    });

    logRestoreSummary({ restored: result.restored, failed: result.failed, realm });
    logRuntime(timer);
}

// ============================================================================
// BACKUP SITE PREFERENCES
// Trigger backup job and download metadata via WebDAV
// ============================================================================

async function backupSitePreferences() {
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
    logRuntime(timer);
}

// ============================================================================
// PRIVATE HELPER FUNCTIONS
// Small focused functions that support the command workflows above
// ============================================================================

/**
 * Load deletion list, or run analyze-preferences if not found
 * @param {string} instanceType - Instance type
 * @param {Object} timer - Timer instance for runtime logging
 * @returns {Promise<string[]|null>} Preference IDs or null if unavailable
 */
async function loadOrGenerateDeletionList(instanceType, timer) {
    let preferences = loadPreferencesForDeletion(instanceType);

    if (preferences) {
        return preferences;
    }

    console.log(`\n${LOG_PREFIX.WARNING} Preferences for deletion file not found`
        + ` for instance type: ${instanceType}\n`);

    const analyzeAnswers = await inquirer.prompt(runAnalyzePreferencesPrompt(instanceType));

    if (!analyzeAnswers.runAnalyze) {
        console.log(`\n${LOG_PREFIX.INFO} Preference removal cancelled.\n`);
        logRuntime(timer);
        return null;
    }

    try {
        await runAnalyzePreferencesSubprocess();
    } catch (error) {
        console.log(`\nERROR: ${error.message}`);
        logRuntime(timer);
        return null;
    }

    preferences = loadPreferencesForDeletion(instanceType);
    if (!preferences) {
        console.log(`\n${LOG_PREFIX.WARNING} Preferences file still not found.`
            + ' Please check the analyze-preferences output.\n');
        logRuntime(timer);
        return null;
    }

    return preferences;
}

/**
 * Open preferences file in editor and handle errors
 * @param {string} instanceType - Instance type
 * @param {Object} timer - Timer instance for runtime logging
 * @returns {Promise<boolean>} True if successful
 */
async function reviewPreferencesInEditor(instanceType, timer) {
    try {
        const filePath = await openPreferencesForDeletionInEditor(instanceType);
        console.log(`${LOG_PREFIX.INFO} Opened preferences file in VS Code: ${filePath}\n`);
        return true;
    } catch (error) {
        console.log(`${LOG_PREFIX.WARNING} Could not open file in VS Code: ${error.message}`);
        console.log('  Make sure VS Code is installed and accessible via the "code" command.\n');
        logRuntime(timer);
        return false;
    }
}

/**
 * Log top prefix summary for preferences being deleted
 * @param {string[]} preferences - Preference IDs
 */
function logDeletionPrefixSummary(preferences) {
    const summary = generateDeletionSummary(preferences);
    console.log('Top Preference Prefixes Being Removed:');
    summary.topPrefixes.forEach(([prefix, count]) => {
        const percentage = ((count / summary.total) * 100).toFixed(1);
        console.log(`  - ${prefix}: ${count} (${percentage}%)`);
    });
    console.log('');
}

/**
 * Select realms for an instance type with validation
 * @param {string} instanceType - Instance type
 * @returns {Promise<string[]|null>} Selected realms or null
 */
async function selectRealmsForInstance(instanceType) {
    const realmsForInstance = getRealmsByInstanceType(instanceType);
    if (!realmsForInstance || realmsForInstance.length === 0) {
        console.log(`No realms found for instance type: ${instanceType}`);
        return null;
    }

    const realmSelection = await inquirer.prompt([{
        name: 'realms',
        message: 'Select realms to process:',
        type: 'checkbox',
        choices: realmsForInstance,
        default: realmsForInstance
    }]);

    const selected = realmSelection.realms;
    if (!selected || selected.length === 0) {
        console.log('No realms selected.');
        return null;
    }

    return selected;
}

/**
 * Get the path to the preferences-for-deletion file
 * @param {string} instanceType - Instance type
 * @returns {string} Absolute path
 */
function getDeletionFilePath(instanceType) {
    return path.join(
        process.cwd(),
        DIRECTORIES.RESULTS,
        instanceType,
        IDENTIFIERS.ALL_REALMS,
        `${instanceType}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`
    );
}

/**
 * Handle backup creation workflow: classify realms, prompt user, create backups
 * @param {string[]} realmsToProcess - All selected realms
 * @param {string} objectType - Object type
 * @param {string} instanceType - Instance type
 * @param {string} preferencesFilePath - Path to deletion list
 */
async function handleBackupCreation(realmsToProcess, objectType, instanceType, preferencesFilePath) {
    const { withBackups, withoutBackups } = classifyRealmBackupStatus(
        realmsToProcess, objectType, instanceType
    );

    logBackupClassification(withBackups, withoutBackups);

    let realmsToBackup = withoutBackups;

    if (withBackups.length > 0) {
        const overwriteAnswers = await inquirer.prompt([{
            type: 'confirm',
            name: 'createNew',
            message: `${withBackups.length} realm(s) already have backup files.`
                + ' Create new ones anyway?',
            default: false
        }]);

        if (overwriteAnswers.createNew) {
            console.log(`${LOG_PREFIX.INFO} Will create new backups for all realms.\n`);
            realmsToBackup = realmsToProcess;
        } else {
            console.log(`${LOG_PREFIX.INFO} Will skip realms that already have backups.\n`);
        }
    }

    if (realmsToBackup.length === 0) {
        console.log(
            'No realms need backup creation. All realms already have up-to-date backups.\n'
        );
        return true;
    }

    const refreshAnswers = await inquirer.prompt([{
        type: 'confirm',
        name: 'refreshMetadata',
        message: 'Trigger backup job and download latest metadata for realms needing backup?',
        default: false
    }]);

    const { successCount } = await createBackupsForRealms({
        realmsToBackup,
        instanceType,
        objectType,
        preferencesFilePath,
        refreshMetadata: refreshAnswers.refreshMetadata
    });

    if (successCount === 0) {
        console.log(
            `${LOG_PREFIX.WARNING} All backup creations failed. `
            + 'Cannot proceed without backups.\n'
        );
        return false;
    }

    return true;
}

/**
 * Load a backup file and run validation with user-prompted corrections
 * @param {string} backupFilePath - Path to backup JSON file
 * @returns {Promise<Object|null>} Validated backup object or null on failure
 */
async function loadAndValidateBackup(backupFilePath) {
    console.log('Loading backup file...');
    let backup = await loadBackupFile(backupFilePath);
    console.log(`${LOG_PREFIX.INFO} Loaded ${backup.attributes.length} preference(s)\n`);

    console.log('Validating backup structure...');
    const validation = validateAndCorrectBackup(backup);

    if (validation.corrected) {
        console.log(`${LOG_PREFIX.WARNING} Found issues in backup file:\n`);
        validation.corrections.forEach(msg => console.log(msg));

        const correctAnswers = await inquirer.prompt([{
            type: 'confirm',
            name: 'applyCorrections',
            message: '\nApply these corrections before restore?',
            default: true
        }]);

        if (correctAnswers.applyCorrections) {
            backup = validation.backup;
            console.log(`\n${LOG_PREFIX.INFO} Corrections applied to backup\n`);
        } else {
            console.log(
                `\n${LOG_PREFIX.WARNING} Proceeding with original backup (may cause errors).\n`
            );
        }
    } else {
        console.log(`${LOG_PREFIX.INFO} Backup structure is valid\n`);
    }

    return backup;
}
