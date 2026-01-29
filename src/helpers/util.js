import path from 'path';
import fs from 'fs';

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
 * @param {string} searchPath - Root path to search from
 * @returns {Array<string>} Array of paths to cartridge folders found
 */
export function findCartridgeFolders(searchPath) {
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
                            if (cartridge.isDirectory() && !cartridge.name.startsWith('.')) {
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
                        cartridgeNames.add(entry.name);
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
