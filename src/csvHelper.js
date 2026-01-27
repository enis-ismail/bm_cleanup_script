import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllSites, getSiteById } from './api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Derive realm name from hostname
 */
function deriveRealm(hostname) {
    return String(hostname || '').split('.')[0] || 'realm';
}

/**
 * Compact values for CSV/log output
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

/**
 * Export all sites with their cartridge paths to CSV
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
 * Export site preferences attributes to CSV
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

/**
 * Write usage CSV with dynamic site-specific value columns
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
 * Write matrix CSV: preferenceId vs sites (X marks usage)
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
