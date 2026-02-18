import path from 'path';
import fs from 'fs';
import { getInstanceType } from '../../../helpers.js';

/**
 * Find the latest backup file for a given realm
 * @param {string} realm - Realm name
 * @param {string} objectType - Object type (default: SitePreferences)
 * @returns {string|null} Path to latest backup file or null if not found
 */
export function findLatestBackupFile(realm, objectType = 'SitePreferences') {
    const instanceType = getInstanceType(realm);
    const backupDir = path.join(process.cwd(), 'backup', instanceType);

    if (!fs.existsSync(backupDir)) {
        return null;
    }

    const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(`${realm}_${objectType}_backup_`) && f.endsWith('.json'))
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
