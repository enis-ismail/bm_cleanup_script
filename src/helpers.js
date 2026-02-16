import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getResultsPath, ensureResultsDir } from './helpers/util.js';
import { logError } from './helpers/log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIG MANAGEMENT HELPERS
// Load and manage configuration file
// ============================================================================

/**
 * Load configuration from config.json file
 * @returns {Object} Parsed configuration object
 * @private
 */
function loadConfig() {
    const configPath = path.resolve(__dirname, '../config.json');
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (error) {
        logError(`Failed to load config.json: ${error.message}`);
        throw error;
    }
}

/**
 * Save configuration to config.json file
 * @param {Object} config - Configuration object to save
 * @private
 */
function saveConfig(config) {
    const configPath = path.resolve(__dirname, '../config.json');
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
        logError(`Failed to save config.json: ${error.message}`);
        throw error;
    }
}

/**
 * Find realm configuration by name
 * @param {string} realmName - Realm name to find
 * @param {Object} config - Configuration object
 * @returns {Object|null} Realm configuration or null if not found
 * @private
 */
function findRealmInConfig(realmName, config) {
    return config.realms.find(r => r.name === realmName) || null;
}

/**
 * Retrieve sandbox configuration for a specific realm
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} realmName - Name of the realm to retrieve
 * @returns {Object} Sandbox configuration object
 */
export function getSandboxConfig(realmName) {
    const config = loadConfig();
    const realm = findRealmInConfig(realmName, config);
    if (!realm) {
        throw new Error(`Realm '${realmName}' not found in config.json`);
    }
    return realm;
}

/**
 * Retrieve full realm configuration for a specific realm
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} realmName - Name of the realm to retrieve
 * @returns {Object} Full realm configuration object
 */
export function getRealmConfig(realmName) {
    return getSandboxConfig(realmName);
}

/**
 * Get list of all configured realm names
 * See .github/instructions/function-reference.md for detailed documentation
 * @returns {string[]} Array of realm names
 */
export function getAvailableRealms() {
    const config = loadConfig();
    return config.realms.map(r => r.name);
}

/**
 * Get the instance type for a specific realm
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} realmName - Name of the realm
 * @returns {string} Instance type (sandbox, development, staging, production)
 */
export function getInstanceType(realmName) {
    const config = loadConfig();
    const realm = findRealmInConfig(realmName, config);
    if (!realm) {
        throw new Error(`Realm '${realmName}' not found in config.json`);
    }
    return realm.instanceType || 'sandbox';
}

/**
 * Get all realms for a specific instance type
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} instanceType - Instance type (sandbox, development, staging, production)
 * @returns {string[]} Array of realm names for the given instance type
 */
export function getRealmsByInstanceType(instanceType) {
    const config = loadConfig();
    return config.realms
        .filter(r => r.instanceType === instanceType)
        .map(r => r.name);
}

/**
 * Get validation configuration settings
 * See .github/instructions/function-reference.md for detailed documentation
 * @returns {Object} Validation configuration object
 */
export function getValidationConfig() {
    const config = loadConfig();
    return config.validation || { ignoreBmCartridges: true };
}

/**
 * Get backup job configuration settings
 * @returns {Object} Backup configuration
 */
export function getBackupConfig() {
    const config = loadConfig();
    const backup = config.backup || {};

    return {
        jobId: backup.jobId || 'site_preferences - BACKUP',
        pollIntervalMs: backup.pollIntervalMs || 5000,
        timeoutMs: backup.timeoutMs || 10 * 60 * 1000,
        ocapiVersion: backup.ocapiVersion || 'v25_6',
        webdavFilePath: backup.webdavFilePath || '/on/demandware.servlet/webdav/Sites/Impex/src/meta_data_backup.zip',
        outputDir: backup.outputDir || './backup_downloads'
    };
}

/**
 * Get WebDAV configuration for a realm
 * @param {string} realmName - Name of the realm
 * @returns {Object} WebDAV configuration
 */
export function getWebdavConfig(realmName) {
    const config = loadConfig();
    const realm = findRealmInConfig(realmName, config);

    if (!realm) {
        throw new Error(`Realm '${realmName}' not found in config.json`);
    }

    const backup = config.backup || {};

    return {
        hostname: realm.hostname,
        username: backup.webdavUsername || '',
        password: backup.webdavPassword || '',
        filePath: backup.webdavFilePath || ''
    };
}

/**
 * Extract realm name from a hostname URL
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} hostname - Full hostname URL
 * @returns {string} Extracted realm name or "realm" as fallback
 */
export function deriveRealm(hostname) {
    return String(hostname || '').split('.')[0] || 'realm';
}

/**
 * Add a new realm configuration to config.json
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} name - Unique identifier for the realm
 * @param {string} hostname - Full hostname of the sandbox
 * @param {string} clientId - OCAPI client ID
 * @param {string} clientSecret - OCAPI client secret
 * @param {string} [siteTemplatesPath] - Optional path to site templates directory
 * @param {string} [instanceType] - Instance type (sandbox, development, staging, production)
 * @returns {boolean} true if realm was added successfully
 */
export function addRealmToConfig(name, hostname, clientId, clientSecret, siteTemplatesPath = '', instanceType = 'sandbox') {
    try {
        const configPath = path.resolve(__dirname, '../config.json');
        let config = fs.existsSync(configPath)
            ? loadConfig()
            : { realms: [] };

        if (findRealmInConfig(name, config)) {
            console.error(`Realm '${name}' already exists in config.json`);
            return false;
        }

        const newRealm = {
            name,
            hostname,
            clientId,
            clientSecret,
            instanceType
        };

        if (siteTemplatesPath && siteTemplatesPath.trim() !== '') {
            newRealm.siteTemplatesPath = siteTemplatesPath.trim();
        }

        config.realms.push(newRealm);
        saveConfig(config);
        console.log(`Realm '${name}' added to config.json`);
        return true;
    } catch (error) {
        logError(`Failed to add realm to config: ${error.message}`);
        return false;
    }
}

/**
 * Remove a realm configuration from config.json
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} realmName - Name of the realm to remove
 * @returns {Promise<boolean>} true if realm was removed successfully
 */
export async function removeRealmFromConfig(realmName) {
    try {
        const config = loadConfig();

        if (!findRealmInConfig(realmName, config)) {
            console.error(`Realm '${realmName}' not found in config.json`);
            return false;
        }

        config.realms = config.realms.filter(r => r.name !== realmName);
        saveConfig(config);
        console.log(`Realm '${realmName}' removed from config.json`);
        return true;
    } catch (error) {
        logError(`Failed to remove realm from config: ${error.message}`);
        return false;
    }
}

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
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');

        return lines.map(line =>
            line.split(',').map(value => {
                const trimmed = value.trim();
                return (trimmed.startsWith('"') && trimmed.endsWith('"'))
                    ? trimmed.slice(1, -1)
                    : trimmed;
            })
        );
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
