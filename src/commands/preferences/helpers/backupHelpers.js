import path from 'path';
import fs from 'fs';
import { getInstanceType } from '../../../index.js';
import { LOG_PREFIX, DIRECTORIES, IDENTIFIERS, FILE_PATTERNS } from '../../../config/constants.js';
import { logSectionTitle } from '../../../helpers/log.js';
import { refreshMetadataBackupForRealm, getMetadataBackupPathForRealm } from '../../../helpers/backupJob.js';
import { generate as generateSitePreferencesBackup } from './generateSitePreferences.js';
import { findLatestUsageCsv } from './csvHelpers.js';

/**
 * Find the latest backup file for a given realm
 * @param {string} realm - Realm name
 * @param {string} objectType - Object type (default: SitePreferences)
 * @returns {string|null} Path to latest backup file or null if not found
 */
export function findLatestBackupFile(realm, objectType = IDENTIFIERS.SITE_PREFERENCES) {
    const instanceType = getInstanceType(realm);
    const backupDir = path.join(process.cwd(), DIRECTORIES.BACKUP, instanceType);

    if (!fs.existsSync(backupDir)) {
        return null;
    }

    const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(`${realm}_${objectType}${FILE_PATTERNS.BACKUP_SUFFIX}`) && f.endsWith('.json'))
        .sort()
        .reverse();

    return files.length > 0
        ? path.join(backupDir, files[0])
        : null;
}

/**
 * Validate and correct backup attribute definitions
 * Ensures all fields are in proper OCAPI format (objects for localized fields, etc)
 * @param {Object} backup - Backup object
 * @returns {Object} {corrected: boolean, corrections: string[], backup: correctedBackup}
 */
export function validateAndCorrectBackup(backup) {
    const corrections = [];
    const correctedBackup = JSON.parse(JSON.stringify(backup));

    for (let i = 0; i < correctedBackup.attributes.length; i++) {
        const attr = correctedBackup.attributes[i];

        // Check display_name
        if (attr.display_name && typeof attr.display_name === 'string') {
            corrections.push(`  - Fixed display_name for "${attr.id}": string -> object`);
            attr.display_name = { default: attr.display_name };
        }

        // Check description
        if (attr.description) {
            if (typeof attr.description === 'string') {
                corrections.push(`  - Fixed description for "${attr.id}": string -> object`);
                attr.description = { default: attr.description };
            } else if (typeof attr.description === 'object' && (attr.description._ || attr.description.$)) {
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
                    corrections.push(`  - Cleaned description for "${attr.id}": removed xml2js artifacts`);
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
                attr.default_value = { value: typedValue };
            } else if (typeof attr.default_value === 'object') {
                if (attr.default_value._ || attr.default_value.$ || ('default' in attr.default_value && !('value' in attr.default_value))) {
                    needsFix = true;
                    let rawValue = attr.default_value._ || attr.default_value.default || Object.values(attr.default_value).find(v => typeof v !== 'object') || null;
                    if (rawValue !== null) {
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
                corrections.push(`  - Fixed default_value for "${attr.id}": converted to {value: <typed>}`);
            }
        }

        // Clean any lingering xml2js artifacts
        const xmljsKeys = Object.keys(attr).filter(k => k === '_' || k === '$');
        if (xmljsKeys.length > 0) {
            corrections.push(`  - Removed xml2js artifacts from "${attr.id}"`);
            xmljsKeys.forEach(k => delete attr[k]);
        }
    }

    return {
        corrected: corrections.length > 0,
        corrections,
        backup: correctedBackup
    };
}

// ============================================================================
// BACKUP CREATION HELPERS
// Functions for creating realm backups during remove-preferences workflow
// ============================================================================

/**
 * Resolve metadata file path for a realm, optionally downloading fresh copy
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @param {boolean} forceRefresh - Force download even if file exists
 * @returns {Promise<{ok: boolean, path: string|null, reason?: string}>}
 */
export async function resolveMetadataPath(realm, instanceType, forceRefresh) {
    let metadataPath = getMetadataBackupPathForRealm(realm, instanceType);

    if (forceRefresh || !fs.existsSync(metadataPath)) {
        console.log('STEP 5.1: Download Metadata Backup\n');
        if (!fs.existsSync(metadataPath)) {
            console.log(`${LOG_PREFIX.WARNING} No existing metadata file found. Triggering backup job...\n`);
        }
        console.log('Triggering backup job and downloading metadata...');
        const refreshResult = await refreshMetadataBackupForRealm(realm, instanceType);

        if (refreshResult.ok) {
            console.log(`${LOG_PREFIX.INFO} Downloaded metadata: ${refreshResult.filePath}\n`);
            return { ok: true, path: refreshResult.filePath };
        }

        console.log(`${LOG_PREFIX.WARNING} Failed to download metadata: ${refreshResult.reason}`);
        console.log('Cannot create backup without metadata. Skipping this realm.\n');
        return { ok: false, path: null, reason: refreshResult.reason };
    }

    console.log('STEP 5.1: Using Existing Metadata\n');
    console.log(`${LOG_PREFIX.INFO} Found metadata: ${metadataPath}\n`);
    return { ok: true, path: metadataPath };
}

/**
 * Create a backup for a single realm (metadata + CSV -> backup JSON)
 * @param {Object} options - Backup creation options
 * @param {string} options.realm - Realm name
 * @param {string} options.instanceType - Instance type
 * @param {string} options.objectType - Object type (e.g. 'SitePreferences')
 * @param {string} options.preferencesFilePath - Path to the deletion list file
 * @param {string} options.metadataPath - Resolved metadata file path
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createRealmBackup({
    realm, instanceType, objectType, preferencesFilePath, metadataPath, backupDate
}) {
    console.log('STEP 5.2: Generate Backup from CSV + Metadata\n');

    const usageFilePath = findLatestUsageCsv(realm, instanceType);
    if (usageFilePath) {
        console.log(`Using usage CSV: ${path.basename(usageFilePath)}`);
    } else {
        console.log(`${LOG_PREFIX.WARNING} No usage CSV found. Site values will not be included in backup.`);
    }

    const backupDir = path.join(process.cwd(), DIRECTORIES.BACKUP, instanceType);
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const date = backupDate || new Date().toISOString().split('T')[0];
    const backupFilePath = path.join(backupDir, `${realm}_${objectType}_backup_${date}.json`);

    const result = await generateSitePreferencesBackup({
        unusedPreferencesFile: preferencesFilePath,
        csvFile: usageFilePath,
        xmlMetadataFile: metadataPath,
        outputFile: backupFilePath,
        realm,
        instanceType,
        objectType,
        verbose: true
    });

    if (!result.success) {
        console.log(`${LOG_PREFIX.WARNING} Failed to create backup file: ${result.error}`);
        console.log('Skipping this realm.\n');
        return { success: false, error: result.error };
    }

    console.log(`${LOG_PREFIX.INFO} Backup created: ${result.outputPath}`);
    console.log(`   Total attributes: ${result.stats.total}`);
    console.log(`   Groups added: ${result.stats.groups}`);
    console.log(`   Preferences with site values: ${result.stats.withValues}\n`);
    return { success: true };
}

/**
 * Orchestrate backup creation for multiple realms (Step 5 of remove-preferences)
 * Handles metadata resolution and backup generation for each realm.
 * @param {Object} options - Options
 * @param {string[]} options.realmsToBackup - Realms that need new backups
 * @param {string} options.instanceType - Instance type
 * @param {string} options.objectType - Object type
 * @param {string} options.preferencesFilePath - Path to deletion list file
 * @param {boolean} options.refreshMetadata - Whether to force fresh metadata download
 */
export async function createBackupsForRealms({
    realmsToBackup, instanceType, objectType, preferencesFilePath, refreshMetadata
}) {
    const backupDate = new Date().toISOString().split('T')[0];
    let successCount = 0;

    for (const realm of realmsToBackup) {
        logSectionTitle(`Backup: ${realm} (${instanceType})`);

        const metadata = await resolveMetadataPath(realm, instanceType, refreshMetadata);
        if (!metadata.ok) {
            continue;
        }

        const result = await createRealmBackup({
            realm, instanceType, objectType, preferencesFilePath,
            metadataPath: metadata.path, backupDate
        });

        if (result.success) {
            successCount++;
        }
    }

    return { successCount, totalCount: realmsToBackup.length };
}
