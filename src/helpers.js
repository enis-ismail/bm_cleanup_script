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
 *
 * Purpose: Gets the full configuration object (hostname, credentials) for
 * a named realm from config.json. This is used to establish connections
 * to SFCC instances.
 *
 * @param {string} realmName - Name of the realm to retrieve (e.g., "bcwr-080")
 * @returns {Object} Sandbox configuration object containing:
 *   - name: Realm identifier
 *   - hostname: SFCC sandbox hostname
 *   - clientId: OCAPI client ID
 *   - clientSecret: OCAPI client secret
 * @throws {Error} If realm is not found in config.json
 *
 * @example
 * const sandbox = getSandboxConfig("bcwr-080")
 * // Returns: { name: "bcwr-080", hostname: "bcwr-080.sandbox.com", clientId: "...", clientSecret: "..." }
 */
export function getSandboxConfig(realmName) {
    const realm = config.realms.find(r => r.name === realmName);
    if (!realm) {
        throw new Error(`Realm '${realmName}' not found in config.json`);
    }
    return realm;
}

/**
 * Get list of all configured realm names
 *
 * Purpose: Returns an array of available realm identifiers from config.json.
 * Used for presenting selection menus and validating realm names.
 *
 * @returns {string[]} Array of realm names (e.g., ["bcwr-080", "prod-realm"])
 *
 * @example
 * getAvailableRealms() // Returns: ["bcwr-080", "staging-realm"]
 */
export function getAvailableRealms() {
    return config.realms.map(r => r.name);
}

/**
 * Extract realm name from a hostname URL
 *
 * Purpose: Converts a hostname like "bcwr-080.sandbox.com" to just "bcwr-080"
 * This is used to derive simple identifiers from full hostnames.
 *
 * @param {string} hostname - Full hostname URL (e.g., "bcwr-080.sandbox.com")
 * @returns {string} Extracted realm name (e.g., "bcwr-080") or "realm" as fallback
 *
 * @example
 * deriveRealm("bcwr-080.sandbox.com") // Returns: "bcwr-080"
 * deriveRealm("my-realm.demandware.net") // Returns: "my-realm"
 * deriveRealm("") // Returns: "realm"
 */
export function deriveRealm(hostname) {
    return String(hostname || '').split('.')[0] || 'realm';
}

/**
 * Add a new realm configuration to config.json
 *
 * Purpose: Registers a new SFCC sandbox realm with its credentials
 * Creates config.json if it doesn't exist. Prevents duplicate realm names.
 *
 * @param {string} name - Unique identifier for the realm (e.g., "bcwr-080")
 * @param {string} hostname - Full hostname of the sandbox (e.g., "bcwr-080.sandbox.com")
 * @param {string} clientId - OCAPI client ID for authentication
 * @param {string} clientSecret - OCAPI client secret for authentication
 * @returns {boolean} true if realm was added successfully, false otherwise
 *
 * @example
 * addRealmToConfig("prod-realm", "prod.example.com", "client123", "secret456")
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
 *
 * Purpose: Deletes a realm entry from the configuration file
 * Validates that the realm exists before attempting removal.
 *
 * @param {string} realmName - Name of the realm to remove
 * @returns {Promise<boolean>} true if realm was removed successfully, false otherwise
 *
 * @example
 * await removeRealmFromConfig("old-realm")
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
 *
 * Purpose: Creates the directory structure for storing realm-specific output files
 * Creates all parent directories if they don't exist (recursive).
 *
 * @param {string} realm - Realm name to create directory for
 * @returns {string} Absolute path to the created/verified directory
 *
 * @example
 * ensureRealmDir("bcwr-080")
 * // Returns: "C:/path/to/project/results/bcwr-080"
 * // Creates: results/bcwr-080/ if it doesn't exist
 */
export function ensureRealmDir(realm) {
    const dir = path.resolve(__dirname, '..', 'results', realm);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Write test data to a JSON file with optional console output
 *
 * Purpose: Saves test/debug data to a JSON file for inspection
 * Used during development to capture API responses and intermediate data.
 *
 * @param {string} filename - Name/path of the file to write
 * @param {*} data - Data to serialize as JSON (any serializable type)
 * @param {Object} options - Configuration options
 * @param {boolean} [options.consoleOutput=true] - Whether to log to console
 * @param {*} [options.preview] - Optional data preview to display in console
 *
 * @example
 * writeTestOutput("test.json", { users: [...] }, { preview: { count: 10 } })
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
 *
 * Purpose: SFCC custom attributes are prefixed with "c_" in the API.
 * This function removes that prefix to get the actual attribute name.
 *
 * @param {string} id - Preference ID that may have "c_" prefix
 * @returns {string} Normalized ID without "c_" prefix
 *
 * @example
 * normalizeId("c_enableApplePay") // Returns: "enableApplePay"
 * normalizeId("enableApplePay") // Returns: "enableApplePay"
 * normalizeId(null) // Returns: undefined
 */
export function normalizeId(id) {
    return id?.startsWith('c_') ? id.substring(2) : id;
}

/**
 * Check if an object key represents actual preference data
 *
 * Purpose: SFCC API responses include metadata keys like "_v", "_type", "link"
 * This function filters out those metadata keys to identify actual preference values.
 *
 * @param {string} key - Object key to check
 * @returns {boolean} true if the key represents preference data, false if metadata
 *
 * @example
 * isValueKey("siteName") // Returns: true
 * isValueKey("_v") // Returns: false
 * isValueKey("link") // Returns: false
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
 *
 * Purpose: Scans the results folder for realm-specific subdirectories and
 * locates their corresponding matrix files. The matrix file shows which
 * preferences have values set across different sites.
 *
 * Expected file pattern: results/{realm}/{realm}_sandbox_preferences_matrix.csv
 *
 * @returns {Array<{realm: string, matrixFile: string}>} Array of objects containing:
 *   - realm: Name of the realm
 *   - matrixFile: Absolute path to the matrix CSV file
 *
 * @example
 * findAllMatrixFiles()
 * // Returns: [
 * //   { realm: "bcwr-080", matrixFile: "/path/to/results/bcwr-080/bcwr-080_sandbox_preferences_matrix.csv" }
 * // ]
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

    // For each realm folder, look for the matrix file
    for (const folder of realmFolders) {
        const realmName = folder.name;
        const realmDir = path.join(resultsDir, realmName);
        const expectedMatrixFile = path.join(realmDir, `${realmName}_sandbox_preferences_matrix.csv`);

        // Check if the matrix file exists
        if (fs.existsSync(expectedMatrixFile)) {
            matrixFiles.push({
                realm: realmName,
                matrixFile: expectedMatrixFile
            });
        } else {
            console.warn(`Matrix file not found for realm '${realmName}': ${expectedMatrixFile}`);
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
 *
 * Purpose: Reads a preference matrix CSV file and converts it into a nested array
 * where each row is an array of cell values. Handles quoted values and removes
 * surrounding quotes from CSV cells.
 *
 * CSV Structure:
 * - Row 0: Header row (preferenceId, site1, site2, ...)
 * - Row 1+: Data rows (preferenceId, "X" or "", "X" or "", ...)
 *
 * The "X" marker indicates a preference has a value set for that site.
 *
 * @param {string} filePath - Absolute path to the CSV file to parse
 * @returns {Array<Array<string>>} 2D array where:
 *   - First dimension: rows (index 0 = header, 1+ = data)
 *   - Second dimension: columns (index 0 = preferenceId, 1+ = site values)
 *
 * @example
 * parseCSVToNestedArray("/path/to/matrix.csv")
 * // Returns:
 * // [
 * //   ["preferenceId", "SiteA", "SiteB", "SiteC"],
 * //   ["enableApplePay", "X", "", "X"],
 * //   ["enablePayPal", "", "X", "X"]
 * // ]
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
 *
 * Purpose: Analyzes the preference matrix to find preferences that have no
 * values set across any site. A preference is considered "unused" if all
 * site columns are empty (no "X" markers).
 *
 * Analysis Logic:
 * - Skip header row (index 0)
 * - For each data row, check columns 1+ for "X" or "x"
 * - If no "X" found in any column, preference is unused
 *
 * @param {Array<Array<string>>} csvData - Parsed CSV data from parseCSVToNestedArray
 * @returns {string[]} Array of unused preference IDs
 *
 * @example
 * const csvData = [
 *   ["preferenceId", "SiteA", "SiteB"],
 *   ["usedPref", "X", ""],
 *   ["unusedPref", "", ""]
 * ]
 * findUnusedPreferences(csvData) // Returns: ["unusedPref"]
 */
export function findUnusedPreferences(csvData) {
    if (csvData.length <= 1) {
        // No data rows or only header
        return [];
    }

    const unusedPreferences = [];

    // Skip the header row (index 0) and check data rows
    for (let i = 1; i < csvData.length; i++) {
        const row = csvData[i];
        const preferenceId = row[0];

        // Check if all site columns (index 1 onwards) are empty
        const hasValue = row.slice(1).some(value => value === 'X' || value === 'x');

        if (!hasValue && preferenceId) {
            unusedPreferences.push(preferenceId);
        }
    }

    return unusedPreferences;
}

/**
 * Write unused preferences list to a text file
 *
 * Purpose: Creates a human-readable report of unused preferences for a realm.
 * The file includes metadata (timestamp, count) and the full list of unused IDs.
 *
 * File Format:
 * - Header with realm name and generation timestamp
 * - Total count of unused preferences
 * - List of all unused preference IDs (one per line)
 *
 * @param {string} realmDir - Absolute path to the realm's output directory
 * @param {string} realm - Realm name for the file naming and header
 * @param {string[]} unusedPreferences - Array of unused preference IDs
 * @returns {string} Absolute path to the created file
 *
 * @example
 * writeUnusedPreferencesFile(
 *   "/path/to/results/bcwr-080",
 *   "bcwr-080",
 *   ["unusedPref1", "unusedPref2"]
 * )
 * // Creates: /path/to/results/bcwr-080/bcwr-080_unused_preferences.txt
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
