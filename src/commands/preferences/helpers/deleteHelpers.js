/**
 * Delete & Subprocess Helpers
 * Handles preference deletion across realms and analyze-preferences subprocess execution
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { LOG_PREFIX, SEPARATOR, DIRECTORIES, FILE_PATTERNS } from '../../../config/constants.js';
import { updateAttributeDefinitionById } from '../../../api/api.js';
import { loadBackupFile } from '../../../io/backupUtils.js';
import { restorePreferencesForRealm } from './restoreHelper.js';
import { validateAndCorrectBackup } from './backupHelpers.js';

/**
 * Run analyze-preferences as a child process
 * Spawns a subprocess and streams output to the console.
 * @returns {Promise<boolean>} True if the subprocess completed successfully
 */
export function runAnalyzePreferencesSubprocess() {
    return new Promise((resolve, reject) => {
        console.log('\nRunning analyze-preferences command...\n');
        console.log(`${SEPARATOR}\n`);

        const analyzeProcess = spawn('node', ['src/main.js', 'analyze-preferences'], {
            stdio: 'inherit',
            shell: true
        });

        analyzeProcess.on('close', (code) => {
            console.log(`\n${SEPARATOR}\n`);
            if (code === 0) {
                console.log(`${LOG_PREFIX.INFO} analyze-preferences completed successfully!\n`);
                resolve(true);
            } else {
                reject(new Error(`analyze-preferences exited with code ${code}`));
            }
        });

        analyzeProcess.on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * Delete preferences across multiple realms via OCAPI
 * @param {Object} options - Deletion options
 * @param {string[]} options.realmsToProcess - Realms to delete from
 * @param {string[]} options.preferences - Preference IDs to delete
 * @param {string} options.objectType - Object type (e.g. 'SitePreferences')
 * @returns {Promise<{totalDeleted: number, totalFailed: number}>}
 */
export async function deletePreferencesForRealms({ realmsToProcess, preferences, objectType, dryRun = false }) {
    const modeLabel = dryRun ? '[DRY RUN] Simulating' : 'Deleting';
    console.log(`${modeLabel} ${preferences.length} preferences from ${realmsToProcess.length} realm(s)...\n`);

    let totalDeleted = 0;
    let totalFailed = 0;

    for (const realm of realmsToProcess) {
        console.log(`Processing realm: ${realm}\n`);

        let realmDeleted = 0;
        let realmFailed = 0;

        for (const preferenceId of preferences) {
            if (dryRun) {
                realmDeleted++;
                totalDeleted++;
                console.log(`  ${LOG_PREFIX.INFO} [DRY RUN] Would delete: ${preferenceId}`);
                continue;
            }

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

        const summaryLabel = dryRun ? 'would delete' : 'deleted';
        console.log(`\n  Realm summary: ${realmDeleted} ${summaryLabel}, ${realmFailed} failed`);
        console.log('');
    }

    return { totalDeleted, totalFailed };
}

/**
 * Restore preferences from today's backup files across multiple realms
 * @param {Object} options - Restore options
 * @param {string[]} options.realmsToProcess - Realms to restore
 * @param {string[]} options.preferences - Preference IDs to restore
 * @param {string} options.objectType - Object type (e.g. 'SitePreferences')
 * @param {string} options.instanceType - Instance type
 * @returns {Promise<{totalRestored: number, totalFailed: number}>}
 */
export async function restorePreferencesFromBackups({
    realmsToProcess, preferences, objectType, instanceType
}) {
    console.log('\nRestoring preferences from backups...\n');

    let totalRestored = 0;
    let totalFailed = 0;

    for (const realm of realmsToProcess) {
        console.log(`Restoring realm: ${realm}\n`);

        const backupFilePath = getBackupFilePath(realm, objectType, instanceType);

        if (!fs.existsSync(backupFilePath)) {
            console.log(`${LOG_PREFIX.WARNING} Backup file not found at: ${backupFilePath}`);
            console.log('   Skipping this realm...\n');
            continue;
        }

        console.log(`Loading backup: ${path.basename(backupFilePath)}`);
        let backup = await loadBackupFile(backupFilePath);

        const validation = validateAndCorrectBackup(backup);
        if (validation.corrected) {
            console.log(`${LOG_PREFIX.WARNING} Auto-corrected ${validation.corrections.length} issue(s) in backup`);
            backup = validation.backup;
        }

        const result = await restorePreferencesForRealm({
            preferenceIds: preferences, backup, objectType, instanceType, realm
        });

        totalRestored += result.restored;
        totalFailed += result.failed;
    }

    return { totalRestored, totalFailed };
}

/**
 * Construct backup file path for today's date
 * @param {string} realm - Realm name
 * @param {string} objectType - Object type
 * @param {string} instanceType - Instance type
 * @param {string} [date] - Override date (YYYY-MM-DD), defaults to today
 * @returns {string} Absolute path to the backup file
 */
export function getBackupFilePath(realm, objectType, instanceType, date) {
    const backupDate = date || new Date().toISOString().split('T')[0];
    return path.join(
        process.cwd(),
        DIRECTORIES.BACKUP,
        instanceType,
        `${realm}_${objectType}${FILE_PATTERNS.BACKUP_SUFFIX}${backupDate}.json`
    );
}

/**
 * Classify realms into those with existing (today's) backups and those without
 * @param {string[]} realmsToProcess - Realms to check
 * @param {string} objectType - Object type
 * @param {string} instanceType - Instance type
 * @returns {{withBackups: string[], withoutBackups: string[]}}
 */
export function classifyRealmBackupStatus(realmsToProcess, objectType, instanceType) {
    const withBackups = [];
    const withoutBackups = [];

    for (const realm of realmsToProcess) {
        if (fs.existsSync(getBackupFilePath(realm, objectType, instanceType))) {
            withBackups.push(realm);
        } else {
            withoutBackups.push(realm);
        }
    }

    return { withBackups, withoutBackups };
}
