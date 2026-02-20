/**
 * Preference Backup Helper
 * Utilities for loading and validating SFCC attribute backup files
 */

import fs from 'fs/promises';
import path from 'path';
import { DIRECTORIES, FILE_PATTERNS, BACKUP_CONFIG } from '../config/constants.js';

/**
 * Fields that are valid for creating new attribute definitions
 * All other fields are read-only or system-generated and must be excluded
 */
const CREATE_SAFE_FIELDS = [
    'id',
    'display_name',
    'description',
    'value_type',
    'mandatory',
    'localizable',
    'multi_value_type',
    'visible',
    'queryable',
    'searchable',
    'site_specific',
    'default_value',
    'min_length',
    'max_length',
    'min_value',
    'max_value',
    'value_definitions'
];

/**
 * Transform attribute definition into create-safe body
 * Strips out all read-only and system-generated fields
 * @param {Object} attributeDefinition - Full attribute definition from OCAPI
 * @returns {Object} Create-safe attribute definition
 */
export function buildCreateSafeBody(attributeDefinition) {
    const createSafeBody = {};

    for (const field of CREATE_SAFE_FIELDS) {
        if (attributeDefinition[field] !== undefined) {
            createSafeBody[field] = attributeDefinition[field];
        }
    }

    return createSafeBody;
}

/**
 * Check if a backup file exists and get its age in days
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @param {string} objectType - Object type (e.g., "SitePreferences")
 * @returns {Promise<{exists: boolean, filePath: string, ageInDays: number, backup: Object}>} Backup file info
 */
export async function checkBackupFileAge(realm, instanceType, objectType) {
    const backupDir = path.join(process.cwd(), DIRECTORIES.BACKUP, instanceType);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `${realm}_${objectType}${FILE_PATTERNS.BACKUP_SUFFIX}${timestamp}.json`;
    const filePath = path.join(backupDir, filename);

    try {
        await fs.access(filePath);
        const backup = await loadBackupFile(filePath);
        const backupDate = new Date(backup.backup_date);
        const now = new Date();
        const ageInDays = Math.floor((now - backupDate) / BACKUP_CONFIG.MS_PER_DAY);

        return {
            exists: true,
            filePath,
            ageInDays,
            backup
        };
    } catch {
        return {
            exists: false,
            filePath,
            ageInDays: null,
            backup: null
        };
    }
}

/**
 * Validate backup file structure
 * @param {string} backupFilePath - Path to backup file
 * @returns {Promise<Object>} Validated backup data
 */
export async function loadBackupFile(backupFilePath) {
    const content = await fs.readFile(backupFilePath, 'utf-8');
    const backup = JSON.parse(content);

    // Validate required fields
    const requiredFields = ['backup_date', 'realm', 'object_type', 'attributes', 'attribute_groups'];
    for (const field of requiredFields) {
        if (!backup[field]) {
            throw new Error(`Invalid backup file: missing required field '${field}'`);
        }
    }

    return backup;
}

/**
 * Check backup file status for multiple realms
 * @param {Array<string>} realms - List of realm names
 * @param {string} objectType - Object type (e.g., "SitePreferences")
 * @returns {Promise<Array<{realm: string, exists: boolean, ageInDays: number, filePath: string}>>}
 */
export async function checkBackupStatusForRealms(realms, objectType) {
    const { getSandboxConfig } = await import('../config/helpers/helpers.js');
    const results = [];

    for (const realm of realms) {
        const sandbox = getSandboxConfig(realm);
        const backupInfo = await checkBackupFileAge(realm, sandbox.instanceType, objectType);

        results.push({
            realm,
            exists: backupInfo.exists,
            ageInDays: backupInfo.ageInDays,
            filePath: backupInfo.filePath,
            tooOld: backupInfo.exists && backupInfo.ageInDays >= 14
        });
    }

    return results;
}

/**
 * Load backup file and return attributes
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @param {string} objectType - Object type
 * @returns {Promise<Array|null>} Attributes array or null if not found
 */
export async function loadCachedBackup(realm, instanceType, objectType) {
    const backupInfo = await checkBackupFileAge(realm, instanceType, objectType);

    if (!backupInfo.exists) {
        return null;
    }

    return backupInfo.backup.attributes;
}
