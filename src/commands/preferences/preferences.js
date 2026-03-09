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
import * as prompts from '../prompts/index.js';
import {
    LOG_PREFIX, DIRECTORIES, IDENTIFIERS, FILE_PATTERNS, ANALYSIS_STEPS
} from '../../config/constants.js';
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
    executePreferenceSummarization,
    executePreferenceSummarizationFromMetadata
} from '../../helpers/analyzer.js';
import { exportSitesCartridgesToCSV } from '../../io/csv.js';
import {
    findAllActivePreferencesUsage,
    getActivePreferencesFromMatrices
} from '../../io/codeScanner.js';
import {
    generateDeletionSummary,
    buildRealmPreferenceMapFromFiles,
    buildCrossRealmPreferenceMap,
    openRealmDeletionFilesInEditor,
    openCrossRealmFileInEditor
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
        .option('--dry-run', 'Simulate deletion without making any changes')
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
    const repositoryAnswers = await inquirer.prompt(
        await prompts.repositoriesMultiSelectPrompt(siblings)
    );
    const repositoryPaths = repositoryAnswers.repositories.map(
        repo => path.join(path.dirname(process.cwd()), repo)
    );

    const selection = await prompts.resolveRealmScopeSelection(inquirer.prompt);
    const realmsToProcess = selection.realmList;

    if (!validateRealmsSelection(realmsToProcess)) {
        return;
    }

    // Hardcoded defaults — objectType is always SitePreferences,
    // scope is always all sites, and defaults are always included
    const objectType = IDENTIFIERS.SITE_PREFERENCES;
    const scope = 'all';
    const siteId = undefined;
    const includeDefaults = true;

    const useCachedBackup = await prompts.promptBackupCachePreference(realmsToProcess, objectType);

    // --- STEP 2: Backup, Fetch & Summarize ---
    logSectionTitle('STEP 2: Backup, Fetch & Summarize Preferences');

    const realmEntries = realmsToProcess.map(realm => ({
        realm,
        instanceType: getInstanceType(realm)
    }));

    if (realmEntries.length === 0) {
        console.log(`\n${LOG_PREFIX.ERROR} No realms to process. Aborting.\n`);
        logRuntime(timer);
        return;
    }

    const allResults = [];
    const display = new RealmProgressDisplay(250);
    display.start();

    try {
        const realmPromises = realmEntries.map(
            async ({ realm, instanceType }) => {
                let realmHostname;

                try {
                    const realmConfig = getSandboxConfig(realm);
                    realmHostname = realmConfig.hostname;
                } catch (configError) {
                    // Config lookup failed — can't even identify the realm
                    console.error(
                        `${LOG_PREFIX.ERROR} ${realm}: ${configError.message}`
                    );
                    return {
                        realm, success: false,
                        error: configError, mode: 'config'
                    };
                }

                // Step 1: Trigger backup job and download metadata XML
                display.setTotalSteps(realmHostname, ANALYSIS_STEPS.METADATA);
                display.startStep(
                    realmHostname, realm, 'backup', 'Downloading Backup'
                );

                let refreshResult;
                try {
                    refreshResult = await refreshMetadataBackupForRealm(
                        realm,
                        instanceType,
                        { forceJobExecution: !useCachedBackup }
                    );
                } catch (backupError) {
                    refreshResult = { ok: false, reason: backupError.message };
                }

                if (refreshResult.ok) {
                    if (refreshResult.status === 'EXISTING') {
                        console.log(
                            `${LOG_PREFIX.INFO} ${realm}: using existing metadata backup (no new job execution).`
                        );
                    } else {
                        console.log(
                            `${LOG_PREFIX.INFO} ${realm}: using freshly generated metadata backup (job execution).`
                        );
                    }

                    display.completeStep(realmHostname, 'backup');

                    // Steps 2-5: metadata flow (fetch, groups, matrices, export)
                    try {
                        const result = await executePreferenceSummarizationFromMetadata(
                            {
                                realm, objectType, instanceType, scope, siteId,
                                metadataFilePath: refreshResult.filePath,
                                repositoryPaths
                            },
                            { display, hostname: realmHostname, realmName: realm }
                        );
                        display.completeRealm(realmHostname);
                        return {
                            realm,
                            success: true,
                            result,
                            mode: 'metadata',
                            backupStatus: refreshResult.status || 'OK'
                        };
                    } catch (realmError) {
                        display.failStep(realmHostname, 'fetch');
                        display.failRealm(realmHostname, realmError.message);
                        return {
                            realm, success: false, error: realmError, mode: 'metadata'
                        };
                    }
                }

                // Backup failed — fall back to OCAPI
                const backupReason = refreshResult.reason || 'unknown';
                console.log(
                    `${LOG_PREFIX.WARNING} ${realm}: switching to old data method (OCAPI) — ${backupReason}`
                );
                display.failStep(realmHostname, 'backup');
                display.setTotalSteps(realmHostname, ANALYSIS_STEPS.OCAPI);

                try {
                    const result = await executePreferenceSummarization(
                        {
                            realm, objectType, instanceType, scope, siteId,
                            includeDefaults, useCachedBackup, repositoryPaths
                        },
                        { display, hostname: realmHostname, realmName: realm }
                    );
                    display.completeRealm(realmHostname);
                    return {
                        realm, success: true, result,
                        mode: 'ocapi', backupReason, backupStatus: 'FALLBACK_OCAPI'
                    };
                } catch (realmError) {
                    display.failStep(realmHostname, 'fetch');
                    display.failRealm(realmHostname, realmError.message);
                    return {
                        realm, success: false, error: realmError,
                        mode: 'ocapi', backupReason
                    };
                }
            }
        );

        const results = await Promise.all(realmPromises);
        allResults.push(...results);
    } finally {
        display.finish();
    }

    console.log('');

    console.log(`${LOG_PREFIX.INFO} Metadata strategy by realm:`);
    for (const result of allResults) {
        if (result.mode === 'metadata') {
            if (result.backupStatus === 'EXISTING') {
                console.log(`  - ${result.realm}: metadata existing file (no job run)`);
            } else {
                console.log(`  - ${result.realm}: metadata fresh job execution`);
            }
        } else if (result.mode === 'ocapi') {
            console.log(
                `  - ${result.realm}: switched to old OCAPI method`
                + `${result.backupReason ? ` (${result.backupReason})` : ''}`
            );
        } else {
            console.log(`  - ${result.realm}: ${result.mode || 'unknown mode'}`);
        }
    }
    console.log('');

    // Report backup fallbacks (why metadata was skipped per realm)
    const ocapiFallbacks = allResults.filter(r => r.backupReason);
    if (ocapiFallbacks.length > 0) {
        for (const { realm, backupReason } of ocapiFallbacks) {
            console.log(
                `${LOG_PREFIX.WARNING} ${realm}: ` +
                `metadata backup skipped — ${backupReason}. Used OCAPI.`
            );
        }
        console.log('');
    }

    // Report failures
    const failures = allResults.filter(r => !r.success);
    if (failures.length > 0) {
        for (const { realm, error, mode } of failures) {
            console.error(`${LOG_PREFIX.ERROR} ${realm} (${mode}): ${error.message}`);
        }
        if (failures.length === allResults.length) {
            console.log(`\n${LOG_PREFIX.ERROR} All realms failed. Aborting.\n`);
            logRuntime(timer);
            return;
        }
    }

    console.log('');

    // --- STEP 3: Check Preference Usage ---
    logSectionTitle('STEP 3: Checking Preference Usage');

    const realmsProcessed = allResults.filter(r => r.success).map(r => r.realm);
    const matrixFiles = findAllMatrixFiles(realmsProcessed);

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

    // --- STEP 5: Refresh Active Site Cartridge Lists ---
    logSectionTitle('STEP 5: Refresh Active Site Cartridge Lists');

    if (realmsProcessed.length > 0) {
        const exportResults = await Promise.all(
            realmsProcessed.map(async (realm) => {
                try {
                    await exportSitesCartridgesToCSV(realm);
                    return { realm, success: true };
                } catch (error) {
                    return { realm, success: false, error };
                }
            })
        );

        const exportFailures = exportResults.filter(r => !r.success);
        const exportSuccesses = exportResults.length - exportFailures.length;

        console.log(
            `${LOG_PREFIX.INFO} Refreshed active site cartridge lists for ${exportSuccesses}`
            + `/${exportResults.length} realm(s).`
        );

        if (exportFailures.length > 0) {
            for (const { realm, error } of exportFailures) {
                console.log(
                    `${LOG_PREFIX.WARNING} ${realm}: failed to export site cartridge list — `
                    + `${error.message}`
                );
            }
            console.log(
                `${LOG_PREFIX.WARNING} Realm-specific deletion tags may fall back to `
                + `${IDENTIFIERS.ALL} for affected realm(s).`
            );
        }
    }

    // --- STEP 6: Find Preference Usage in Cartridges ---
    logSectionTitle('STEP 6: Finding Preference Usage in Cartridges');

    if (repositoryPaths.length > 0 && realmsProcessed.length > 0) {
        const repoNames = repositoryPaths.map(p => path.basename(p));
        const repoLabel = repoNames.length === 1
            ? repoNames[0]
            : `${repoNames.length} repositories`;
        const realmsByInstanceType = new Map();

        for (const realm of realmsProcessed) {
            const instanceType = getInstanceType(realm);
            if (!realmsByInstanceType.has(instanceType)) {
                realmsByInstanceType.set(instanceType, []);
            }
            realmsByInstanceType.get(instanceType).push(realm);
        }

        const scanDisplay = new RealmProgressDisplay(250);
        const scanStep = `scan_${Date.now()}`;
        scanDisplay.startStep(
            'codeScanner', 'Code Scanner', scanStep,
            `Scanning ${repoLabel} for references`
        );
        scanDisplay.start();

        const scanCallback = (scannedCount, totalFiles) => {
            const percentage = Math.round(
                (scannedCount / totalFiles) * 100
            );
            scanDisplay.setStepProgress(
                'codeScanner', scanStep, percentage
            );
            scanDisplay.setStepMessage(
                'codeScanner', scanStep,
                `${scannedCount}/${totalFiles} files`, 'info'
            );
        };

        try {
            for (const [instanceType, realmsForType] of realmsByInstanceType.entries()) {
                console.log(
                    `${LOG_PREFIX.INFO} Creating deletion list for instance type `
                    + `${instanceType} (${realmsForType.length} realm(s))...`
                );

                await findAllActivePreferencesUsage(repositoryPaths, {
                    instanceTypeOverride: instanceType,
                    progressCallback: scanCallback,
                    realmFilter: realmsForType
                });

                const deletionFilePath = path.join(
                    process.cwd(),
                    DIRECTORIES.RESULTS,
                    instanceType,
                    IDENTIFIERS.ALL_REALMS,
                    `${instanceType}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`
                );

                if (fs.existsSync(deletionFilePath)) {
                    console.log(`${LOG_PREFIX.INFO} Deletion list created: ${deletionFilePath}`);
                } else {
                    console.log(
                        `${LOG_PREFIX.WARNING} No deletion list created for ${instanceType}. `
                        + 'This usually means no candidates were found after safety filters.'
                    );
                }
            }

            scanDisplay.completeStep('codeScanner', scanStep);
        } catch (scanError) {
            scanDisplay.failStep('codeScanner', scanStep);
            throw scanError;
        } finally {
            scanDisplay.finish();
        }
    }

    console.log('');
    logRuntime(timer);
}

// ============================================================================
// REMOVE PREFERENCES
// Load deletion list -> backup -> delete -> optional restore
// ============================================================================

async function removePreferences(options = {}) {
    const dryRun = options.dryRun === true;
    const timer = startTimer();

    if (dryRun) {
        const yellow = '\x1b[33m';
        const reset = '\x1b[0m';
        console.log(`${yellow}\n  ⚠  DRY-RUN MODE: No preferences will actually be deleted.${reset}\n`);
    }

    // --- STEP 1: Select Instance Type ---
    logSectionTitle('STEP 1: Select Instance Type');
    const { instanceType } = await inquirer.prompt(prompts.instanceTypePrompt('development'));

    // --- STEP 2: Select Realms to Process ---
    logSectionTitle('STEP 2: Select Realms to Process');
    const realmsToProcess = await selectRealmsForInstance(instanceType);
    if (!realmsToProcess) {
        logRuntime(timer);
        return;
    }

    // --- STEP 3: Select Deletion Level ---
    logSectionTitle('STEP 3: Select Deletion Level');
    const { deletionLevel } = await inquirer.prompt(prompts.deletionLevelPrompt());

    logDeletionLevelSummary(deletionLevel);

    // --- STEP 4: Select Deletion Source ---
    logSectionTitle('STEP 4: Select Deletion Source');
    const { deletionSource } = await inquirer.prompt(prompts.deletionSourcePrompt());
    const useCrossRealm = deletionSource === 'cross-realm';

    if (useCrossRealm) {
        console.log(
            `\n${LOG_PREFIX.INFO} Using cross-realm intersection file.`
            + ' The same preference list will be applied to all selected realms.\n'
        );
    } else {
        console.log(
            `\n${LOG_PREFIX.INFO} Using per-realm deletion files.`
            + ' Each realm has its own deletion candidates.\n'
        );
    }

    // --- STEP 5: Load Deletion Lists ---
    logSectionTitle(useCrossRealm
        ? 'STEP 5: Load Cross-Realm Deletion List'
        : 'STEP 5: Load Per-Realm Deletion Lists');

    let perRealmResult;

    if (useCrossRealm) {
        perRealmResult = buildCrossRealmPreferenceMap(
            realmsToProcess, instanceType, { maxTier: deletionLevel }
        );

        if (perRealmResult.missingRealms.length > 0 || !perRealmResult.filePath) {
            console.log(
                `\n${LOG_PREFIX.WARNING} Cross-realm deletion file not found for '${instanceType}'.`
            );
            console.log(
                `${LOG_PREFIX.INFO} Run analyze-preferences to generate this file.\n`
            );

            const analyzeAnswers = await inquirer.prompt(
                prompts.runAnalyzePreferencesPrompt(instanceType)
            );

            if (!analyzeAnswers.runAnalyze) {
                console.log(`\n${LOG_PREFIX.INFO} Preference removal cancelled.\n`);
                logRuntime(timer);
                return;
            }

            try {
                await runAnalyzePreferencesSubprocess();
            } catch (error) {
                console.log(`\nERROR: ${error.message}`);
                logRuntime(timer);
                return;
            }

            // Retry loading cross-realm file after analyze
            perRealmResult = buildCrossRealmPreferenceMap(
                realmsToProcess, instanceType, { maxTier: deletionLevel }
            );

            if (!perRealmResult.filePath) {
                console.log(
                    `\n${LOG_PREFIX.WARNING} Cross-realm deletion file still not found.`
                    + ' Please check the analyze-preferences output.\n'
                );
                logRuntime(timer);
                return;
            }
        }
    } else {
        // Per-realm files (original behavior)
        perRealmResult = buildRealmPreferenceMapFromFiles(
            realmsToProcess, instanceType, { maxTier: deletionLevel }
        );

        if (perRealmResult.missingRealms.length > 0) {
            console.log(
                `\n${LOG_PREFIX.WARNING} Per-realm deletion files not found for:`
                + ` ${perRealmResult.missingRealms.join(', ')}`
            );
            console.log(
                `${LOG_PREFIX.INFO} Run analyze-preferences to generate per-realm`
                + ' deletion files.\n'
            );

            const analyzeAnswers = await inquirer.prompt(
                prompts.runAnalyzePreferencesPrompt(instanceType)
            );

            if (!analyzeAnswers.runAnalyze) {
                console.log(`\n${LOG_PREFIX.INFO} Preference removal cancelled.\n`);
                logRuntime(timer);
                return;
            }

            try {
                await runAnalyzePreferencesSubprocess();
            } catch (error) {
                console.log(`\nERROR: ${error.message}`);
                logRuntime(timer);
                return;
            }

            // Retry loading per-realm files after analyze
            const retryResult = buildRealmPreferenceMapFromFiles(
                realmsToProcess, instanceType, { maxTier: deletionLevel }
            );

            if (retryResult.missingRealms.length === realmsToProcess.length) {
                console.log(
                    `\n${LOG_PREFIX.WARNING} Per-realm deletion files still not found.`
                    + ' Please check the analyze-preferences output.\n'
                );
                logRuntime(timer);
                return;
            }

            Object.assign(perRealmResult, retryResult);
        }
    }

    const { realmPreferenceMap } = perRealmResult;

    if (perRealmResult.skippedByWhitelist.length > 0) {
        console.log(
            `${LOG_PREFIX.INFO} Whitelist skipped`
            + ` ${perRealmResult.skippedByWhitelist.length} preference(s).`
        );
    }

    if (perRealmResult.blockedByBlacklist.length > 0) {
        console.log(
            `${LOG_PREFIX.INFO} Blacklist protected`
            + ` ${perRealmResult.blockedByBlacklist.length} preference(s).`
        );
    }

    logPerRealmDeletionSummary(realmPreferenceMap, dryRun);

    // Check if any realm has preferences to delete
    const totalUniquePrefs = new Set(
        Array.from(realmPreferenceMap.values()).flat()
    ).size;
    if (totalUniquePrefs === 0) {
        console.log(
            `\n${LOG_PREFIX.INFO} No preferences to delete for selected realms.\n`
        );
        logRuntime(timer);
        return;
    }

    const preferenceIds = [...new Set(Array.from(realmPreferenceMap.values()).flat())];

    // --- STEP 6: Review Deletion Files ---
    logSectionTitle(useCrossRealm
        ? 'STEP 6: Review Cross-Realm Deletion File'
        : 'STEP 6: Review Per-Realm Deletion Files');
    try {
        if (useCrossRealm) {
            const openedFile = await openCrossRealmFileInEditor(instanceType);
            if (openedFile) {
                console.log(
                    `${LOG_PREFIX.INFO} Opened cross-realm deletion file in VS Code.\n`
                );
            } else {
                console.log(
                    `${LOG_PREFIX.WARNING} Cross-realm deletion file not found to open.\n`
                );
            }
        } else {
            const openedFiles = await openRealmDeletionFilesInEditor(
                realmsToProcess, instanceType
            );
            if (openedFiles.length > 0) {
                console.log(
                    `${LOG_PREFIX.INFO} Opened ${openedFiles.length} per-realm`
                    + ' deletion file(s) in VS Code.\n'
                );
            } else {
                console.log(
                    `${LOG_PREFIX.WARNING} No per-realm deletion files found to open.\n`
                );
            }
        }

        // Show blacklist/whitelist reminders
        const { listBlacklist } = await import('../setup/helpers/blacklistHelper.js');
        const { listWhitelist } = await import('../setup/helpers/whitelistHelper.js');
        const entries = listBlacklist();
        if (entries.length > 0) {
            const yellow = '\x1b[33m';
            const reset = '\x1b[0m';
            console.log(
                `${yellow}  ℹ  Blacklisted patterns`
                + ` (these preferences will never be deleted):${reset}`
            );
            for (const entry of entries) {
                const key = entry.type === 'exact'
                    ? (entry.id || entry.pattern) : entry.pattern;
                console.log(`${yellow}     • [${entry.type}] ${key}${reset}`);
            }
            console.log(
                `${yellow}     Manage with: list-blacklist, add-to-blacklist,`
                + ` remove-from-blacklist${reset}\n`
            );
        }

        const whitelistEntries = listWhitelist();
        if (whitelistEntries.length > 0) {
            const cyan = '\x1b[36m';
            const reset = '\x1b[0m';
            console.log(
                `${cyan}  ℹ  Whitelist active`
                + ` (only matching preferences are eligible):${reset}`
            );
            for (const entry of whitelistEntries) {
                const key = entry.type === 'exact'
                    ? (entry.id || entry.pattern) : entry.pattern;
                console.log(`${cyan}     • [${entry.type}] ${key}${reset}`);
            }
            console.log(
                `${cyan}     Manage with: list-whitelist, add-to-whitelist,`
                + ` remove-from-whitelist${reset}\n`
            );
        }
    } catch (error) {
        console.log(
            `${LOG_PREFIX.WARNING} Could not open file(s) in VS Code: ${error.message}`
        );
    }

    logDeletionPrefixSummary(preferenceIds);

    // --- STEP 7: Create Backups ---
    const objectType = IDENTIFIERS.SITE_PREFERENCES;
    if (dryRun) {
        logSectionTitle('STEP 7: Create Backups (Skipped - Dry Run)');
        console.log(`${LOG_PREFIX.INFO} Skipping backup creation in dry-run mode.\n`);
    } else {
        logSectionTitle('STEP 7: Create Backups (Per Realm)');
        const backupsReady = await handleBackupCreation(
            realmsToProcess, objectType, instanceType
        );

        if (!backupsReady) {
            logRuntime(timer);
            return;
        }
    }

    // --- STEP 8: Confirm Deletion ---
    logSectionTitle(`STEP 8: Confirm Deletion${dryRun ? ' (Dry Run)' : ''}`);
    if (dryRun) {
        console.log('Dry-Run Summary:');
        console.log(`  - Realms to process: ${realmsToProcess.length}`);
        console.log(`  - Total unique preferences: ${totalUniquePrefs}`);
        console.log('  - No actual changes will be made\n');
    } else {
        console.log('Backup Summary:');
        console.log(`  - Realms processed: ${realmsToProcess.length}`);
        console.log(`  - Total unique preferences: ${totalUniquePrefs}`);
        console.log('  - Backup files ready for restore if needed\n');
    }

    const confirmAnswers = await inquirer.prompt(prompts.confirmPreferenceDeletionPrompt(
        totalUniquePrefs, dryRun
    ));
    if (!confirmAnswers.confirm) {
        console.log(`\n${LOG_PREFIX.INFO} Preference removal cancelled.`);
        if (!dryRun) {
            console.log(`${LOG_PREFIX.INFO} Backup files have been preserved for future use.\n`);
        }
        logRuntime(timer);
        return;
    }

    // --- STEP 9: Delete Preferences (Per-Realm) ---
    logSectionTitle(`STEP 9: Remove Preferences${dryRun ? ' (Dry Run)' : ''}`);
    const { totalDeleted, totalFailed } = await deletePreferencesForRealms({
        realmPreferenceMap, objectType, dryRun
    });
    logDeletionSummary({
        deleted: totalDeleted, failed: totalFailed, realms: realmsToProcess.length, dryRun
    });
    logRuntime(timer);

    if (dryRun) {
        console.log(`\n${LOG_PREFIX.INFO} Dry-run complete. No preferences were modified.\n`);
        return;
    }

    // --- STEP 10: Optional Restore ---
    logSectionTitle('STEP 10: Restore from Backups (Optional)');
    const restoreAnswers = await inquirer.prompt(prompts.confirmRestoreAfterDeletionPrompt());

    if (!restoreAnswers.restore) {
        console.log(`\n${LOG_PREFIX.INFO} Restore skipped. Deleted preferences remain removed.\n`);
        return;
    }

    console.log('\nRestoring preferences from backups...\n');
    let totalRestored = 0;
    let restoreFailed = 0;

    for (const realm of realmsToProcess) {
        const realmPrefs = realmPreferenceMap.get(realm) || [];
        if (realmPrefs.length === 0) {
            console.log(`Realm ${realm}: No preferences were deleted (skipping restore)\n`);
            continue;
        }

        console.log(`Restoring realm: ${realm} (${realmPrefs.length} preferences)\n`);

        const backupFilePath = findLatestBackupFile(realm, objectType);
        if (!backupFilePath || !fs.existsSync(backupFilePath)) {
            console.log(
                `${LOG_PREFIX.WARNING} No backup file found for realm: ${realm}`
            );
            console.log(
                `   Expected location: backup/${instanceType}/`
                + `${realm}_${objectType}_backup_*.json\n`
            );
            continue;
        }

        console.log(`${LOG_PREFIX.INFO} Found backup: ${path.basename(backupFilePath)}`);

        const backup = await loadAndValidateBackup(backupFilePath);
        if (!backup) {
            console.log(
                `${LOG_PREFIX.WARNING} Failed to load backup for ${realm}. Skipping...\n`
            );
            continue;
        }

        const result = await restorePreferencesForRealm({
            preferenceIds: realmPrefs, backup, objectType, instanceType, realm
        });

        totalRestored += result.restored;
        restoreFailed += result.failed;
    }

    logRestoreSummary({
        restored: totalRestored, failed: restoreFailed, realm: realmsToProcess.length
    });
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

    const realmAnswers = await inquirer.prompt(prompts.realmPrompt());
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

    const confirmAnswers = await inquirer.prompt(prompts.confirmProceedRestorePrompt());

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
    const realmAnswers = await inquirer.prompt(prompts.realmPrompt());
    const realm = realmAnswers.realm;
    const instanceType = getInstanceType(realm);

    console.log('Triggering backup job and downloading metadata...');
    const refreshResult = await refreshMetadataBackupForRealm(
        realm,
        instanceType,
        { forceJobExecution: true }
    );

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
 * Log summary of the selected deletion level
 * @param {string} deletionLevel - Selected deletion level (P1-P5 cascading)
 */
function logDeletionLevelSummary(deletionLevel) {
    const descriptions = {
        P1: 'P1 — Safe to Delete (No Code, No Values)',
        P2: 'P2 — Likely Safe (No Code, Has Values) [includes P1]',
        P3: 'P3 — Deprecated Code Only (No Values) [includes P1-P2]',
        P4: 'P4 — Deprecated Code + Values [includes P1-P3]',
        P5: 'P5 — Realm-Specific (Active Code Not on All Realms) [includes P1-P4]'
    };

    const desc = descriptions[deletionLevel] || deletionLevel;
    console.log(`\nSelected: ${desc}`);
    console.log(
        `  ${LOG_PREFIX.INFO} Each realm uses its own deletion file with`
        + ' realm-specific tier classification'
    );
    console.log('');
}

/**
 * Log per-realm deletion summary showing how many preferences each realm will have deleted
 * @param {Map<string, string[]>} realmPreferenceMap - Map of realm → preference IDs
 * @param {boolean} dryRun - Whether in dry-run mode
 */
function logPerRealmDeletionSummary(realmPreferenceMap, dryRun) {
    const label = dryRun ? 'would be deleted from' : 'to delete from';
    console.log('\nPer-Realm Deletion Breakdown:');

    for (const [realm, prefs] of realmPreferenceMap) {
        console.log(`  ${realm}: ${prefs.length} preference(s) ${label}`);
    }

    // Show ALL-realm vs realm-specific counts
    const allRealmPrefs = new Set();
    const realmSpecificPrefs = new Set();

    for (const [, prefs] of realmPreferenceMap) {
        for (const p of prefs) {
            allRealmPrefs.add(p);
        }
    }

    // Preferences in ALL selected realms = "core" deletions
    const realms = Array.from(realmPreferenceMap.keys());
    for (const prefId of allRealmPrefs) {
        const inAllRealms = realms.every(r => realmPreferenceMap.get(r).includes(prefId));
        if (!inAllRealms) {
            realmSpecificPrefs.add(prefId);
        }
    }

    const coreCount = allRealmPrefs.size - realmSpecificPrefs.size;
    console.log(`\n  Core (all selected realms): ${coreCount} preference(s)`);
    console.log(`  Realm-specific: ${realmSpecificPrefs.size} preference(s)\n`);
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

    const realmSelection = await inquirer.prompt(prompts.selectRealmsForInstancePrompt(instanceType));

    const selected = realmSelection.realms;
    if (!selected || selected.length === 0) {
        console.log('No realms selected.');
        return null;
    }

    return selected;
}

/**
 * Get the per-realm deletion file path for a given realm and instance type.
 * @param {string} realm - Realm name (e.g. 'EU05')
 * @param {string} instanceType - Instance type
 * @returns {string} Absolute path to the per-realm deletion file
 */
function getRealmDeletionFilePath(realm, instanceType) {
    return path.join(
        process.cwd(),
        DIRECTORIES.RESULTS,
        instanceType,
        realm,
        `${realm}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`
    );
}

/**
 * Handle backup creation workflow: classify realms, prompt user, create backups.
 * Uses per-realm deletion file paths so each realm's backup includes only
 * the preferences from that realm's file.
 * @param {string[]} realmsToProcess - All selected realms
 * @param {string} objectType - Object type
 * @param {string} instanceType - Instance type
 */
async function handleBackupCreation(realmsToProcess, objectType, instanceType) {
    const { withBackups, withoutBackups } = classifyRealmBackupStatus(
        realmsToProcess, objectType, instanceType
    );

    logBackupClassification(withBackups, withoutBackups);

    let realmsToBackup = withoutBackups;

    if (withBackups.length > 0) {
        const overwriteAnswers = await inquirer.prompt(
            prompts.overwriteBackupsPrompt(withBackups.length)
        );

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

    // Build per-realm file path map for backup creation
    const realmFilePaths = new Map();
    for (const realm of realmsToBackup) {
        const perRealmPath = getRealmDeletionFilePath(realm, instanceType);
        if (fs.existsSync(perRealmPath)) {
            realmFilePaths.set(realm, perRealmPath);
        }
    }

    const refreshAnswers = await inquirer.prompt(prompts.refreshMetadataPrompt());

    const { successCount } = await createBackupsForRealms({
        realmsToBackup,
        instanceType,
        objectType,
        realmFilePaths,
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

        const correctAnswers = await inquirer.prompt(prompts.applyBackupCorrectionsPrompt());

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
