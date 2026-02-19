import path from 'path';
import fs from 'fs';
import { getValidationConfig, getInstanceType, getAvailableRealms } from '../config/helpers/helpers.js';
import { DIRECTORIES, IDENTIFIERS, FILE_PATTERNS } from '../config/constants.js';

/**
 * Get the absolute path to the results directory
 * @param {string} [realm] - Optional realm name for subdirectory
 * @param {string} [instanceTypeOverride] - Optional instance type override
 * @returns {string} Absolute path to results or results/{instanceType}/{realm} directory
 */
export function getResultsPath(realm = null, instanceTypeOverride = null) {
    const resultsDir = path.join(process.cwd(), DIRECTORIES.RESULTS);
    if (realm) {
        if (realm === IDENTIFIERS.ALL_REALMS) {
            if (instanceTypeOverride) {
                return path.join(resultsDir, instanceTypeOverride, realm);
            }
            return path.join(resultsDir, realm);
        }

        if (instanceTypeOverride) {
            return path.join(resultsDir, instanceTypeOverride, realm);
        }

        try {
            const instanceType = getInstanceType(realm);
            return path.join(resultsDir, instanceType, realm);
        } catch {
            return path.join(resultsDir, 'unknown', realm);
        }
    }
    return resultsDir;
}

/**
 * Ensure results directory exists for a realm
 * @param {string} realm - Realm name
 * @param {string} [instanceTypeOverride] - Optional instance type override
 * @returns {string} Absolute path to the created directory
 */
export function ensureResultsDir(realm, instanceTypeOverride = null) {
    const dir = getResultsPath(realm, instanceTypeOverride);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Get sibling directories of the current project
 * Excludes hidden directories and the current project directory
 * @returns {Promise<Array<string>>} Array of sibling directory names sorted alphabetically
 */
export async function getSiblingRepositories() {
    try {
        // Get the parent directory of the current project
        const currentDir = process.cwd();
        const parentDir = path.dirname(currentDir);
        const currentDirName = path.basename(currentDir);

        // Read all entries in parent directory
        const entries = fs.readdirSync(parentDir);

        // Filter for directories excluding current project and hidden dirs
        const siblings = entries.filter((entry) => {
            if (entry === currentDirName || entry.startsWith('.')) {
                return false;
            }
            const fullPath = path.join(parentDir, entry);
            return fs.statSync(fullPath).isDirectory();
        }).sort();

        return siblings;
    } catch (error) {
        console.error('Error reading sibling repositories:', error.message);
        return [];
    }
}

/**
 * Recursively search for cartridge folders in a project
 * Excludes bm_ cartridges if configured in validation settings
 * @param {string} searchPath - Root path to search from
 * @returns {Array<string>} Array of paths to cartridge folders found
 */
export function findCartridgeFolders(searchPath) {
    const validationConfig = getValidationConfig();
    const ignoreBmCartridges = validationConfig.ignoreBmCartridges;
    const cartridgeNames = new Set();

    try {
        const entries = fs.readdirSync(searchPath, { withFileTypes: true });

        for (const entry of entries) {
            // Skip hidden directories and node_modules
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                continue;
            }

            if (entry.isDirectory()) {
                const fullPath = path.join(searchPath, entry.name);

                // Check if this directory is named "cartridges"
                if (entry.name === 'cartridges') {
                    // Read all cartridges inside this cartridges folder
                    try {
                        const cartridges = fs.readdirSync(fullPath, {
                            withFileTypes: true
                        });
                        for (const cartridge of cartridges) {
                            // Add only directories (actual cartridges)
                            // Optionally exclude bm_ cartridges based on config
                            if (cartridge.isDirectory() &&
                                !cartridge.name.startsWith('.') &&
                                !(ignoreBmCartridges && cartridge.name.startsWith('bm_'))) {
                                cartridgeNames.add(cartridge.name);
                            }
                        }
                    } catch (error) {
                        console.error(
                            `Error reading cartridges from ${fullPath}:`,
                            error.message
                        );
                    }
                } else {
                    const cartridgeDir = path.join(fullPath, 'cartridge');
                    const hasCartridgeFolder = fs.existsSync(cartridgeDir)
                        && fs.statSync(cartridgeDir).isDirectory();

                    if (hasCartridgeFolder) {
                        // Optionally exclude bm_ cartridges based on config
                        if (!(ignoreBmCartridges && entry.name.startsWith('bm_'))) {
                            cartridgeNames.add(entry.name);
                        }
                    } else {
                        // Recursively search subdirectories
                        const subCartridges = findCartridgeFolders(fullPath);
                        subCartridges.forEach((cartridge) => {
                            cartridgeNames.add(cartridge);
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error(
            `Error searching for cartridges in ${searchPath}:`,
            error.message
        );
    }

    return Array.from(cartridgeNames).sort();
}

/**
 * Transform a site object into cartridge info format
 * @param {Object} site - Site object from API
 * @param {string} realmName - Optional realm name to include
 * @returns {Object} Transformed site object with id and cartridges array
 */
export function transformSiteToCartridgeInfo(site, realmName = null) {
    const siteId = site.id || site.site_id || site.siteId || 'N/A';
    const cartridges = site.cartridges || site.cartridgesPath || site.cartridges_path || 'N/A';
    const cartridgeArray = (typeof cartridges === 'string'
        ? cartridges
        : cartridges?.join(':') || 'N/A'
    ).split(':').filter(Boolean);

    return {
        name: realmName ? `${siteId} (${realmName})` : siteId,
        id: siteId,
        ...(realmName && { realm: realmName }),
        cartridges: cartridgeArray
    };
}

/**
 * Build attribute group summaries from attribute groups
 * @param {Array} groups - Array of attribute group objects
 * @returns {Array} Array of group summary objects
 */
export function buildGroupSummaries(groups) {
    return groups.map(g => ({
        groupId: g.id,
        groupName: g.name || g.id,
        displayName: g.display_name || g.displayname || g.id
    }));
}

/**
 * Filter sites by scope (all or single)
 * @param {Array} sites - Array of sites
 * @param {string} scope - 'all' or 'single'
 * @param {string} siteId - Site ID to filter by (if scope is 'single')
 * @returns {Array} Filtered sites array
 */
export function filterSitesByScope(sites, scope, siteId) {
    if (scope === 'single') {
        return sites.filter(s => (s.id || s.site_id || s.siteId) === siteId);
    }
    return sites;
}

/**
 * Calculate validation statistics from comparisons
 * @param {Array} comparisons - Array of comparison objects
 * @returns {Object} Statistics object with counts
 */
export function calculateValidationStats(comparisons) {
    const matchCount = comparisons.filter(c => c.comparison.isMatch).length;
    const mismatchCount = comparisons.length - matchCount;

    return {
        total: comparisons.length,
        matching: matchCount,
        mismatched: mismatchCount
    };
}

// ============================================================================
// REALM DIRECTORY HELPERS
// ============================================================================

/**
 * Ensure a realm-specific directory exists in the results folder
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
// MATRIX FILE DISCOVERY
// ============================================================================

/**
 * Find all preference matrix CSV files in the results directory
 * Expected file pattern: results/{instanceType}/{realm}/{realm}_*_preferences_matrix.csv
 * @returns {Array<{realm: string, matrixFile: string}>} Array of realm and matrix file paths
 */
export function findAllMatrixFiles() {
    const matrixFiles = [];
    const realms = getAvailableRealms();

    for (const realmName of realms) {
        try {
            const realmDir = getResultsPath(realmName);

            if (!fs.existsSync(realmDir)) {
                continue;
            }

            const files = fs.readdirSync(realmDir);
            const matrixFile = files.find(f => f.includes(FILE_PATTERNS.PREFERENCES_MATRIX));

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
