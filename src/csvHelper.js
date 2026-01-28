import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllSites, getSiteById } from './api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 *
 * Purpose: Ensures values fit in CSV cells and don't break formatting.
 * Converts objects to JSON strings and truncates long values to prevent
 * CSV corruption and improve readability.
 *
 * Handles:
 * - null/undefined → empty string
 * - Objects → JSON string (truncated if > 200 chars)
 * - Long strings → truncated with ellipsis
 *
 * @param {*} val - Value of any type to format
 * @returns {string} Formatted, truncated string safe for CSV
 *
 * @example
 * compactValue({ large: "object..." }) // Returns: '{"large":"obj...'
 * compactValue(null) // Returns: ''
 * compactValue("short") // Returns: 'short'
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
 *
 * Purpose: Creates a CSV inventory of all sites in a realm and their
 * associated cartridge paths. This is useful for auditing site configurations
 * and understanding the cartridge stack for each site.
 *
 * Process:
 * 1. Fetch all sites from SFCC
 * 2. Fetch detailed info for each site (parallel requests)
 * 3. Extract site ID and cartridge paths
 * 4. Write to CSV: results/{realm}/active_site_cartridges_list.csv
 *
 * CSV Format:
 * - Column 1: Site ID
 * - Column 2: Cartridge paths (semicolon-separated)
 *
 * @param {Object} sandbox - Sandbox configuration object
 * @param {string} sandbox.hostname - Sandbox hostname for realm derivation
 * @returns {Promise<void>}
 *
 * @example
 * await exportSitesCartridgesToCSV({
 *   hostname: "bcwr-080.sandbox.com",
 *   clientId: "...",
 *   clientSecret: "..."
 * })
 * // Creates: results/bcwr-080/active_site_cartridges_list.csv
 */
export async function exportSitesCartridgesToCSV(sandbox) {
    const sites = await getAllSites(sandbox);
    if (!sites.length) {
        console.log('No sites returned.');
        return;
    }

    // Fetch details for each site (in parallel)
    const details = await Promise.all(
        sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, sandbox))
    );

    // Map to rows of id + cartridges
    const rows = details
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

    const header = 'id,cartridges';
    const csvRows = rows.map(({ id, cartridges }) => {
        const safeCartridges = JSON.stringify(cartridges).replace(/^"|"$/g, '').replace(/,/g, ';');
        return `${id},${safeCartridges}`;
    });

    const csv = [header, ...csvRows].join('\n');
    const realm = deriveRealm(sandbox.hostname);

    // Create results/realm directory if it doesn't exist
    const realmPath = path.resolve(__dirname, '..', 'results', realm);
    fs.mkdirSync(realmPath, { recursive: true });

    const fileName = path.join(realmPath, 'active_site_cartridges_list.csv');
    fs.writeFileSync(fileName, csv);
    console.log(`Sites + cartridges written to ${fileName}`);
}

/**
 * Export site preference attributes to CSV
 *
 * Purpose: Creates a CSV file containing all site preference definitions
 * including IDs, types, default values, and descriptions. This provides
 * a comprehensive catalog of available preferences for documentation.
 *
 * Process:
 * 1. Receive array of preference attributes from SFCC API
 * 2. Determine column order (id first, exclude type, include default_value)
 * 3. Convert to CSV with proper escaping
 * 4. Write to: results/{realm}/{realm}_site_preferences.csv
 *
 * CSV Columns (example):
 * - id: Preference identifier
 * - default_value: Default value if not set
 * - description: Human-readable description
 * - ... other attribute fields
 *
 * Data Handling:
 * - Commas in values are replaced with semicolons
 * - Handles missing default_value by checking 'default' fallback
 * - Removes 'type' column from output
 *
 * @param {Array<Object>} allAttributes - Array of preference attribute objects
 * @param {string} hostname - Sandbox hostname for realm derivation and file naming
 * @returns {Promise<Array<Object>>} The input attributes (passthrough)
 *
 * @example
 * await exportAttributesToCSV(
 *   [
 *     { id: "enableApplePay", default_value: false, description: "Enable Apple Pay" },
 *     { id: "apiKey", default: "test123", description: "API Key" }
 *   ],
 *   "bcwr-080.sandbox.com"
 * )
 * // Creates: results/bcwr-080/bcwr-080_site_preferences.csv
 */
export async function exportAttributesToCSV(allAttributes, hostname) {
    if (allAttributes.length > 0) {
        // Define column order with 'id' first and exclude 'type'
        const firstKeys = Object.keys(allAttributes[0] || {});
        const keySet = new Set(firstKeys);
        // Ensure default_value is included even if missing in the first item
        keySet.add('default_value');
        const orderedKeys = ['id', ...Array.from(keySet).filter(key => key !== 'id' && key !== 'type')];

        const headers = orderedKeys.join(',');
        const rows = allAttributes.map(attr => {
            return orderedKeys.map(key => {
                // For default_value, fall back to 'default' or empty when undefined
                const rawValue = key === 'default_value' ? (attr['default_value'] ?? attr['default'] ?? '') : (attr[key] ?? '');
                // Handle values that might contain commas or quotes
                const stringValue = JSON.stringify(rawValue);
                return stringValue.replace(/^"|"$/g, '').replace(/,/g, ';');
            }).join(',');
        });

        const csv = [headers, ...rows].join('\n');

        // Create realm directory if it doesn't exist
        const realm = deriveRealm(hostname);
        const realmPath = path.resolve(__dirname, '..', 'results', realm);
        fs.mkdirSync(realmPath, { recursive: true });

        // Write to CSV file
        const fileName = path.join(realmPath, `${realm}_site_preferences.csv`);
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
 *
 * Purpose: Creates a comprehensive CSV showing which preferences have which
 * values on each site. This allows you to see the exact configuration of
 * each preference across all sites in one view.
 *
 * CSV Structure:
 * - Base columns: groupId, preferenceId, defaultValue, description, type
 * - Dynamic columns: value_{SiteID} for each site (e.g., value_SiteA, value_SiteB)
 *
 * Process:
 * 1. Collect all unique site IDs from usage data
 * 2. Group preferences by preferenceId (merge multi-site data)
 * 3. Create header with base columns + dynamic site value columns
 * 4. Write rows with all preference details and site-specific values
 *
 * Data Handling:
 * - Uses compactValue() to truncate long values
 * - Escapes quotes and wraps cells in double quotes
 * - Empty cells for sites where preference has no value
 *
 * @param {string} realmDir - Absolute path to realm output directory
 * @param {string} realm - Realm name for file naming
 * @param {string} instanceType - Instance type (e.g., "sandbox", "production")
 * @param {Array<Object>} usageRows - Array of usage records with structure:
 *   - siteId: Site identifier
 *   - preferenceId: Preference identifier
 *   - groupId: Preference group
 *   - defaultValue: Default value
 *   - description: Description text
 *   - value: Actual value set for this site
 * @param {Object} preferenceMeta - Map of preferenceId to metadata (type, etc.)
 * @returns {void}
 *
 * @example
 * writeUsageCSV(
 *   "/path/to/results/bcwr-080",
 *   "bcwr-080",
 *   "sandbox",
 *   [
 *     { siteId: "SiteA", preferenceId: "enableApplePay", value: true, groupId: "Payment", defaultValue: false, description: "..." },
 *     { siteId: "SiteB", preferenceId: "enableApplePay", value: false, groupId: "Payment", defaultValue: false, description: "..." }
 *   ],
 *   { enableApplePay: { type: "boolean" } }
 * )
 * // Creates: results/bcwr-080/bcwr-080_sandbox_preferences_usage.csv
 */
export function writeUsageCSV(realmDir, realm, instanceType, usageRows, preferenceMeta) {
    // Get all unique site IDs
    const allSiteIds = [...new Set(usageRows.map(r => r.siteId))].sort();

    // Build header with dynamic value_SiteID columns
    const baseColumns = ['groupId', 'preferenceId', 'defaultValue', 'description', 'type'];
    const valueColumns = allSiteIds.map(siteId => `value_${siteId}`);
    const csvHeader = [...baseColumns, ...valueColumns];

    // Group rows by preferenceId
    const prefMap = {};
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
    const csvRows = Object.values(prefMap).map(pref => {
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

    const csv = [csvHeader.join(','), ...csvRows].join('\n');
    const csvFile = path.join(realmDir, `${realm}_${instanceType}_preferences_usage.csv`);
    fs.writeFileSync(csvFile, csv);
    console.log(`CSV written to ${csvFile}`);
}

/**
 * Write preference matrix CSV showing usage across sites
 *
 * Purpose: Creates a simple "X marks the spot" matrix showing which preferences
 * are used (have values) on which sites. This provides a quick visual overview
 * of preference usage patterns without the detailed values.
 *
 * CSV Structure:
 * - Column 1: preferenceId
 * - Columns 2+: One column per site (site IDs as headers)
 * - Cell values: "X" if preference has a value on that site, empty if not
 *
 * This matrix is used by the check-preferences command to identify unused
 * preferences (rows with no "X" markers).
 *
 * Process:
 * 1. Create header row with preferenceId + all site IDs
 * 2. For each preference, create row with "X" or "" for each site
 * 3. Quote and escape all values for CSV safety
 * 4. Write to: results/{realm}/{realm}_{instanceType}_preferences_matrix.csv
 *
 * @param {string} realmDir - Absolute path to realm output directory
 * @param {string} realm - Realm name for file naming
 * @param {string} instanceType - Instance type (e.g., "sandbox", "production")
 * @param {Array<Object>} preferenceMatrix - Array of preference objects with structure:
 *   - preferenceId: Preference identifier
 *   - sites: Object mapping siteId -> boolean (true if used)
 * @param {Array<string>} allSiteIds - Ordered array of all site IDs for consistent column order
 * @returns {void}
 *
 * @example
 * writeMatrixCSV(
 *   "/path/to/results/bcwr-080",
 *   "bcwr-080",
 *   "sandbox",
 *   [
 *     { preferenceId: "enableApplePay", sites: { SiteA: true, SiteB: false } },
 *     { preferenceId: "apiKey", sites: { SiteA: true, SiteB: true } }
 *   ],
 *   ["SiteA", "SiteB"]
 * )
 * // Creates CSV:
 * // preferenceId,SiteA,SiteB
 * // enableApplePay,X,
 * // apiKey,X,X
 */
export function writeMatrixCSV(realmDir, realm, instanceType, preferenceMatrix, allSiteIds) {
    const matrixHeader = ['preferenceId', ...allSiteIds];
    const matrixRows = preferenceMatrix.map(pref => {
        const cols = [pref.preferenceId];
        for (const siteId of allSiteIds) {
            cols.push(pref.sites[siteId] ? 'X' : '');
        }
        return cols.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const matrixCsv = [matrixHeader.join(','), ...matrixRows].join('\n');
    const matrixFile = path.join(realmDir, `${realm}_${instanceType}_preferences_matrix.csv`);
    fs.writeFileSync(matrixFile, matrixCsv);
    console.log(`Matrix CSV written to ${matrixFile}`);
}
