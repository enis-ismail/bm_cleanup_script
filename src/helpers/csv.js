import fs from 'fs';
import path from 'path';
import { getAllSites, getSiteById } from '../api.js';
import { ensureResultsDir } from './util.js';

// ============================================================================
// UTILITY FUNCTIONS
// Helper functions for data formatting and processing
// ============================================================================

/**
 * Extract realm name from a hostname URL
 *
 * Purpose: Converts a hostname like "bcwr-080.sandbox.com" to just "bcwr-080"
 * Used to derive simple identifiers for file naming and organization.
 *
 * @param {string} hostname - Full hostname URL (e.g., "bcwr-080.sandbox.com")
 * @returns {string} Extracted realm name (e.g., "bcwr-080") or "realm" as fallback
 *
 * @example
 * deriveRealm("bcwr-080.sandbox.com") // Returns: "bcwr-080"
 * deriveRealm("") // Returns: "realm"
 */
function deriveRealm(hostname) {
    return String(hostname || '').split('.')[0] || 'realm';
}

/**
 * Truncate and format values for safe CSV output
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {*} val - Value of any type to format
 * @returns {string} Formatted, truncated string safe for CSV
 */
export function compactValue(val) {
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') {
        const json = JSON.stringify(val);
        return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    }
    const str = String(val);
    return str.length > 200 ? `${str.slice(0, 200)}…` : str;
}

// ============================================================================
// SITE DATA EXPORT FUNCTIONS
// Functions for exporting SFCC site configurations to CSV
// ============================================================================

/**
 * Export all sites with their cartridge paths to CSV
 * See .github/instructions/function-reference.md for detailed documentation
 * Output: results/{realm}/active_site_cartridges_list.csv
 * @param {string} realm - Realm name for folder/file naming
 * @returns {Promise<void>}
 */
export async function exportSitesCartridgesToCSV(realm) {
    const sites = await getAllSites(realm);
    const details = [];
    let rows = [];
    const header = 'id,cartridges';
    let csvRows = [];
    let csv = '';
    let realmPath = '';
    let fileName = '';

    if (!sites.length) {
        console.log('No sites returned.');
        return;
    }

    // Fetch details for each site (in parallel)
    details.push(...await Promise.all(
        sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, realm))
    ));

    // Map to rows of id + cartridges
    rows = details
        .filter(Boolean)
        .map((site) => {
            const id = site.id || site.site_id || site.siteId || '';
            const cartridges = site.cartridges || site.cartridgesPath || site.cartridges_path || '';
            return { id, cartridges };
        });

    if (!rows.length) {
        console.log('No site details could be resolved.');
        return;
    }

    csvRows = rows.map(({ id, cartridges }) => {
        const safeCartridges = JSON.stringify(cartridges).replace(/^"|"$/g, '').replace(/,/g, ';');
        return `${id},${safeCartridges}`;
    });

    csv = [header, ...csvRows].join('\n');

    // Create results/realm directory if it doesn't exist
    realmPath = ensureResultsDir(realm);

    fileName = path.join(realmPath, `${realm}_active_site_cartridges_list.csv`);
    fs.writeFileSync(fileName, csv);
    console.log(`Sites + cartridges written to ${fileName}`);
}

/**
 * Export site preference attributes to CSV
 * See .github/instructions/function-reference.md for detailed documentation
 * Output: results/{realm}/{realm}_site_preferences.csv
 * @param {Array<Object>} allAttributes - Array of preference attribute objects
 * @param {string} hostname - Sandbox hostname for realm derivation
 * @returns {Promise<Array<Object>>} The input attributes (passthrough)
 */
export async function exportAttributesToCSV(allAttributes, hostname) {
    const firstKeys = Object.keys(allAttributes[0] || {});
    const keySet = new Set(firstKeys);
    let orderedKeys = [];
    let headers = '';
    let rows = [];
    let csv = '';
    let realm = '';
    let realmPath = '';
    let fileName = '';

    if (allAttributes.length > 0) {
        // Define column order with 'id' first and exclude 'type'
        // Ensure default_value is included even if missing in the first item
        keySet.add('default_value');
        orderedKeys = ['id', ...Array.from(keySet).filter(key => key !== 'id' && key !== 'type')];

        headers = orderedKeys.join(',');
        rows = allAttributes.map(attr => {
            return orderedKeys.map(key => {
                // For default_value, fall back to 'default' or empty when undefined
                const rawValue = key === 'default_value' ? (attr['default_value'] ?? attr['default'] ?? '') : (attr[key] ?? '');
                // Handle values that might contain commas or quotes
                const stringValue = JSON.stringify(rawValue);
                return stringValue.replace(/^"|"$/g, '').replace(/,/g, ';');
            }).join(',');
        });

        csv = [headers, ...rows].join('\n');

        // Create realm directory if it doesn't exist
        realm = deriveRealm(hostname);
        realmPath = ensureResultsDir(realm);

        // Write to CSV file
        fileName = path.join(realmPath, `${realm}_site_preferences.csv`);
        fs.writeFileSync(fileName, csv);
        console.log(`Data written to ${fileName}`);
    }

    return allAttributes;
}

// ============================================================================
// PREFERENCE USAGE EXPORT FUNCTIONS
// Functions for exporting detailed preference usage data
// ============================================================================

/**
 * Write detailed preference usage CSV with site-specific value columns
 * See .github/instructions/function-reference.md for detailed documentation
 * Output: results/{realm}/{realm}_{instanceType}_preferences_usage.csv
 * CSV has base columns + dynamic value_{SiteID} columns for each site
 * @param {string} realmDir - Absolute path to realm output directory
 * @param {string} realm - Realm name for file naming
 * @param {string} instanceType - Instance type (e.g., "sandbox", "production")
 * @param {Array<Object>} usageRows - Array of usage records
 * @param {Object} preferenceMeta - Map of preferenceId to metadata
 * @returns {void}
 */
export function writeUsageCSV(realmDir, realm, instanceType, usageRows, preferenceMeta) {
    const allSiteIds = [...new Set(usageRows.map(r => r.siteId))].sort();
    const baseColumns = ['groupId', 'preferenceId', 'defaultValue', 'description', 'type'];
    const valueColumns = allSiteIds.map(siteId => `value_${siteId}`);
    const csvHeader = [...baseColumns, ...valueColumns];
    const prefMap = {};
    let csvRows = [];
    let csv = '';
    let csvFile = '';

    // Get all unique site IDs
    for (const row of usageRows) {
        const prefId = row.preferenceId;
        if (!prefMap[prefId]) {
            prefMap[prefId] = {
                groupId: row.groupId,
                preferenceId: prefId,
                defaultValue: row.defaultValue,
                description: row.description,
                type: preferenceMeta[prefId]?.type || '',
                values: {}
            };
        }
        prefMap[prefId].values[row.siteId] = row.value;
    }

    // Build CSV rows with all base columns + site-specific values
    csvRows = Object.values(prefMap).map(pref => {
        const baseCols = baseColumns.map(key => {
            const raw = pref[key];
            const asString = compactValue(raw);
            const escaped = asString.replace(/"/g, '""');
            return `"${escaped}"`;
        });

        const valueCols = allSiteIds.map(siteId => {
            const value = pref.values[siteId] || '';
            const asString = compactValue(value);
            const escaped = asString.replace(/"/g, '""');
            return `"${escaped}"`;
        });

        return [...baseCols, ...valueCols].join(',');
    });

    csv = [csvHeader.join(','), ...csvRows].join('\n');
    csvFile = path.join(realmDir, `${realm}_${instanceType}_preferences_usage.csv`);
    fs.writeFileSync(csvFile, csv);
    console.log(`CSV written to ${csvFile}`);
}

/**
 * Write preference matrix CSV showing usage across sites
 * See .github/instructions/function-reference.md for detailed documentation
 * Output: results/{realm}/{realm}_{instanceType}_preferences_matrix.csv
 * Columns: preferenceId, defaultValue + one column per site with "X" for usage
 * @param {string} realmDir - Absolute path to realm output directory
 * @param {string} realm - Realm name for file naming
 * @param {string} instanceType - Instance type (e.g., "sandbox", "production")
 * @param {Array<Object>} preferenceMatrix - Array with preferenceId, defaultValue, and sites
 * @param {Array<string>} allSiteIds - Ordered array of all site IDs
 * @returns {void}
 */
export function writeMatrixCSV(realmDir, realm, instanceType, preferenceMatrix, allSiteIds) {
    const matrixHeader = ['preferenceId', 'defaultValue', ...allSiteIds];
    let matrixRows = [];
    let matrixCsv = '';
    let matrixFile = '';

    matrixRows = preferenceMatrix.map(pref => {
        const cols = [
            pref.preferenceId,
            pref.defaultValue ? 'X' : ''
        ];
        for (const siteId of allSiteIds) {
            cols.push(pref.sites[siteId] ? 'X' : '');
        }
        return cols
            .map((v, idx) => {
                // First two columns already have quotes if needed
                if (idx < 2) return v;
                return `"${String(v).replace(/"/g, '""')}"`;
            })
            .join(',');
    });

    matrixCsv = [matrixHeader.join(','), ...matrixRows].join('\n');
    matrixFile = path.join(
        realmDir,
        `${realm}_${instanceType}_preferences_matrix.csv`
    );
    fs.writeFileSync(matrixFile, matrixCsv);
    console.log(`Matrix CSV written to ${matrixFile}`);
}
