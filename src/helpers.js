import fs from 'fs';
import path from 'path';
import { getResultsPath, ensureResultsDir } from './helpers/util.js';
import { logError } from './helpers/log.js';
import {
    getSandboxConfig,
    getRealmConfig,
    getAvailableRealms,
    getInstanceType,
    getRealmsByInstanceType,
    getValidationConfig,
    getBackupConfig,
    getWebdavConfig,
    deriveRealm,
    addRealmToConfig,
    removeRealmFromConfig
} from './config/helpers/helpers.js';

// ============================================================================
// CONFIG MANAGEMENT HELPERS - Re-exported from ./config/helpers/helpers.js
// ============================================================================

export {
    getSandboxConfig,
    getRealmConfig,
    getAvailableRealms,
    getInstanceType,
    getRealmsByInstanceType,
    getValidationConfig,
    getBackupConfig,
    getWebdavConfig,
    deriveRealm,
    addRealmToConfig,
    removeRealmFromConfig
};

// ============================================================================
// FILE SYSTEM HELPERS
// These functions handle directory and file operations
// ============================================================================

/**
 * Ensure a realm-specific directory exists in the results folder
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} realm - Realm name to create directory for
 * @returns {string} Absolute path to the created/verified directory
 */
export function ensureRealmDir(realm) {
    return ensureResultsDir(realm);
}

// ============================================================================
// TEST DATA UTILITIES
// Write test/debug output to files
// ============================================================================

/**
 * Write test data to a JSON file with optional console output
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} filename - Name/path of the file to write
 * @param {*} data - Data to serialize as JSON
 * @param {Object} options - Configuration options
 * @returns {void}
 */
export function writeTestOutput(filename, data, options = {}) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));

    if (options.consoleOutput !== false) {
        console.log(`Full response written to ${filename}`);
        if (options.preview) {
            console.log(JSON.stringify(options.preview, null, 2));
        }
    }
}

// ============================================================================
// PREFERENCE DATA HELPERS
// These functions process and normalize SFCC preference data
// ============================================================================

/**
 * Normalize a preference ID by removing SFCC custom attribute prefix
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} id - Preference ID that may have "c_" prefix
 * @returns {string} Normalized ID without "c_" prefix
 */
export function normalizeId(id) {
    return id?.startsWith('c_') ? id.substring(2) : id;
}

/**
 * Check if an object key represents actual preference data
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} key - Object key to check
 * @returns {boolean} true if key represents preference data, false if metadata
 */
export function isValueKey(key) {
    return !['_v', '_type', 'link', 'site'].includes(key);
}

// ============================================================================
// MATRIX FILE DISCOVERY
// These functions locate and identify preference matrix files
// ============================================================================

/**
 * Find all preference matrix CSV files in the results directory
 * See .github/instructions/function-reference.md for detailed documentation
 * Expected file pattern: results/{instanceType}/{realm}/{realm}_*_preferences_matrix.csv
 * @returns {Array<{realm: string, matrixFile: string}>} Array of realm and matrix file paths
 */
export function findAllMatrixFiles() {
    const matrixFiles = [];
    const realms = getAvailableRealms();

    // For each configured realm, check for matrix files in its results directory
    for (const realmName of realms) {
        try {
            const realmDir = getResultsPath(realmName);

            // Check if realm directory exists
            if (!fs.existsSync(realmDir)) {
                continue;
            }

            // Look for any matrix CSV file in this realm
            const files = fs.readdirSync(realmDir);
            const matrixFile = files.find(f => f.includes('_preferences_matrix.csv'));

            if (matrixFile) {
                matrixFiles.push({
                    realm: realmName,
                    matrixFile: path.join(realmDir, matrixFile)
                });
            }
        } catch {
            // Skip realms with read errors
        }
    }

    return matrixFiles;
}

// ============================================================================
// CSV PARSING FUNCTIONS
// These functions parse and process CSV matrix files
// ============================================================================

/**
 * Parse a CSV file into a 2D array structure
 * See .github/instructions/function-reference.md for detailed documentation
 * CSV Structure: header row + data rows with preferenceId and site values
 * @param {string} filePath - Absolute path to the CSV file
 * @returns {Array<Array<string>>} 2D array of CSV data
 */
export function parseCSVToNestedArray(filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < fileContent.length; i++) {
            const char = fileContent[i];
            const next = fileContent[i + 1];

            if (char === '"') {
                if (inQuotes && next === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (char === ',' && !inQuotes) {
                row.push(field);
                field = '';
                continue;
            }

            if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && next === '\n') {
                    i += 1;
                }

                if (field.length > 0 || row.length > 0) {
                    row.push(field);
                    rows.push(row);
                }

                row = [];
                field = '';
                continue;
            }

            field += char;
        }

        if (field.length > 0 || row.length > 0) {
            row.push(field);
            rows.push(row);
        }

        return rows.filter(r => r.some(value => String(value).trim() !== ''));
    } catch (error) {
        logError(`Failed to parse CSV file: ${error.message}`);
        return [];
    }
}

// ============================================================================
// PREFERENCE USAGE ANALYSIS
// These functions analyze which preferences are used vs unused
// ============================================================================

/**
 * Check if a preference has any value on a site
 * @param {Array<string>} row - CSV row
 * @param {number} siteDataStart - Column index where site data begins
 * @returns {boolean} True if preference has a value on any site
 * @private
 */
function hasValueOnAnySite(row, siteDataStart) {
    return row.slice(siteDataStart).some(v => v === 'X' || v === 'x');
}

/**
 * Check if preference has a default value
 * @param {string} defaultValue - Default value from CSV
 * @returns {boolean} True if default value exists
 * @private
 */
function hasDefaultValue(defaultValue) {
    return defaultValue && defaultValue.trim() !== '';
}
/**
 * Identify unused preferences from parsed CSV matrix data
 * See .github/instructions/function-reference.md for detailed documentation
 * Finds preferences with no "X" values across all sites
 * @param {Array<Array<string>>} csvData - Parsed CSV data
 * @returns {string[]} Array of unused preference IDs
 */
export function findUnusedPreferences(csvData) {
    if (csvData.length <= 1) {
        return [];
    }

    const unusedPreferences = [];
    const headers = csvData[0];
    const preferenceIdIndex = headers.indexOf('preferenceId');
    const defaultValueIndex = headers.indexOf('defaultValue');

    if (preferenceIdIndex === -1) {
        console.warn('preferenceId column not found in CSV');
        return [];
    }

    const siteDataStart = defaultValueIndex > -1 ? defaultValueIndex + 1 : 1;

    for (let i = 1; i < csvData.length; i++) {
        const row = csvData[i];
        const preferenceId = row[preferenceIdIndex];

        if (!preferenceId) continue;

        const defaultValue = defaultValueIndex > -1 ? row[defaultValueIndex] : '';
        const isUsed = hasValueOnAnySite(row, siteDataStart) || hasDefaultValue(defaultValue);

        if (!isUsed) {
            unusedPreferences.push(preferenceId);
        }
    }

    return unusedPreferences;
}

/**
 * Write unused preferences list to a text file
 * See .github/instructions/function-reference.md for detailed documentation
 * Output: {realmDir}/{realm}_unused_preferences.txt
 * @param {string} realmDir - Absolute path to the realm's output directory
 * @param {string} realm - Realm name for file naming
 * @param {string[]} unusedPreferences - Array of unused preference IDs
 * @returns {string} Absolute path to the created file
 */
export function writeUnusedPreferencesFile(realmDir, realm, unusedPreferences) {
    const filename = path.join(realmDir, `${realm}_unused_preferences.txt`);
    const lines = [
        `Unused Preferences for Realm: ${realm}`,
        `Generated: ${new Date().toISOString()}`,
        `Total Unused: ${unusedPreferences.length}`,
        '',
        '--- Preference IDs ---',
        ...unusedPreferences
    ];

    fs.writeFileSync(filename, lines.join('\n'), 'utf-8');
    return filename;
}
