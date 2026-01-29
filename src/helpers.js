import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// REALM CONFIGURATION HELPERS
// These functions manage realm configuration in config.json
// ============================================================================

// Load configuration from config.json containing realm credentials
const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.json'), 'utf-8'));

/**
 * Retrieve sandbox configuration for a specific realm
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} realmName - Name of the realm to retrieve
 * @returns {Object} Sandbox configuration object
 */
export function getSandboxConfig(realmName) {
    const realm = config.realms.find(r => r.name === realmName);
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
    return config.realms.map(r => r.name);
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
 * @returns {boolean} true if realm was added successfully
 */
export function addRealmToConfig(name, hostname, clientId, clientSecret) {
    try {
        const configPath = path.resolve(__dirname, '../config.json');
        let config;

        // Check if config file exists, if not create it with initial structure
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } else {
            console.log('config.json not found. Creating new configuration file...');
            config = { realms: [] };
        }

        // Check if realm already exists
        if (config.realms.some(r => r.name === name)) {
            console.error(`Realm '${name}' already exists in config.json`);
            return false;
        }

        // Add new realm
        config.realms.push({
            name,
            hostname,
            clientId,
            clientSecret
        });

        // Write back to file
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`Realm '${name}' added to config.json`);
        return true;
    } catch (error) {
        console.error('Error adding realm to config:', error.message);
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
        const configPath = path.resolve(__dirname, '../config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        // Check if realm exists
        const realmExists = config.realms.some(r => r.name === realmName);
        if (!realmExists) {
            console.error(`Realm '${realmName}' not found in config.json`);
            return false;
        }

        // Remove realm
        config.realms = config.realms.filter(r => r.name !== realmName);

        // Write back to file
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`Realm '${realmName}' removed from config.json`);
        return true;
    } catch (error) {
        console.error('Error removing realm from config:', error.message);
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
    const dir = path.resolve(__dirname, '..', 'results', realm);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
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
 * Expected file pattern: results/{realm}/{realm}_*_preferences_matrix.csv
 * @returns {Array<{realm: string, matrixFile: string}>} Array of realm and matrix file paths
 */
export function findAllMatrixFiles() {
    const resultsDir = path.resolve(__dirname, '..', 'results');
    const matrixFiles = [];

    // Check if results directory exists
    if (!fs.existsSync(resultsDir)) {
        console.log('Results directory not found.');
        return matrixFiles;
    }

    // Read all folders in results directory
    const items = fs.readdirSync(resultsDir, { withFileTypes: true });
    const realmFolders = items.filter(item => item.isDirectory());

    // For each realm folder, look for matrix files
    for (const folder of realmFolders) {
        const realmName = folder.name;
        const realmDir = path.join(resultsDir, realmName);

        // Look for any matrix CSV file in this realm
        const files = fs.readdirSync(realmDir);
        const matrixFile = files.find(f => f.includes('_preferences_matrix.csv'));

        if (matrixFile) {
            matrixFiles.push({
                realm: realmName,
                matrixFile: path.join(realmDir, matrixFile)
            });
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
        // Read the file content
        const fileContent = fs.readFileSync(filePath, 'utf-8');

        // Split by lines and filter out empty lines
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');

        // Parse each line into an array by splitting on comma
        const nestedArray = lines.map(line => {
            // Split by comma, trim whitespace, and remove surrounding quotes from each value
            return line.split(',').map(value => {
                const trimmed = value.trim();
                // Remove surrounding quotes if present
                if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                    return trimmed.slice(1, -1);
                }
                return trimmed;
            });
        });

        return nestedArray;
    } catch (error) {
        console.error(`Error parsing CSV file: ${error.message}`);
        return [];
    }
}

// ============================================================================
// PREFERENCE USAGE ANALYSIS
// These functions analyze which preferences are used vs unused
// ============================================================================

/**
 * Identify unused preferences from parsed CSV matrix data
 * See .github/instructions/function-reference.md for detailed documentation
 * Finds preferences with no "X" values across all sites
 * @param {Array<Array<string>>} csvData - Parsed CSV data
 * @returns {string[]} Array of unused preference IDs
 */
export function findUnusedPreferences(csvData) {
    if (csvData.length <= 1) {
        // No data rows or only header
        return [];
    }

    const unusedPreferences = [];
    const headers = csvData[0];

    // Find column indices in matrix format
    const preferenceIdIndex = headers.indexOf('preferenceId');
    const defaultValueIndex = headers.indexOf('defaultValue');

    if (preferenceIdIndex === -1) {
        console.warn('preferenceId column not found in CSV');
        return [];
    }

    // Skip the header row and check data rows
    for (let i = 1; i < csvData.length; i++) {
        const row = csvData[i];
        const preferenceId = row[preferenceIdIndex];

        if (!preferenceId) continue;

        // Check if preference has values on any site (all columns after defaultValue)
        const siteDataStart = defaultValueIndex > -1 ? defaultValueIndex + 1 : 1;
        const hasValue = row.slice(siteDataStart).some(v => v === 'X' || v === 'x');

        // Get defaultValue
        const defaultValue = defaultValueIndex > -1 ? row[defaultValueIndex] : '';
        const hasDefault = defaultValue && defaultValue.trim() !== '';

        // Preference is unused if: no values on any site AND no default value
        if (!hasValue && !hasDefault) {
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

    const content = [
        `Unused Preferences for Realm: ${realm}`,
        `Generated: ${new Date().toISOString()}`,
        `Total Unused: ${unusedPreferences.length}`,
        '',
        '--- Preference IDs ---',
        ...unusedPreferences
    ].join('\n');

    fs.writeFileSync(filename, content, 'utf-8');
    return filename;
}
