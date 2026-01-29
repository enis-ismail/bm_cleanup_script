import path from 'path';
import {
    parseCSVToNestedArray,
    findUnusedPreferences,
    writeUnusedPreferencesFile,
    ensureRealmDir,
    getSandboxConfig
} from '../helpers.js';
import { logProcessingRealm, logEmptyCSV, logRealmResults } from './log.js';
import {
    getAttributeGroups,
    getAllSites,
    getSitePreferences
} from '../api.js';
import {
    buildPreferenceMeta,
    processSitesAndGroups,
    buildPreferenceMatrix
} from './summarize.js';
import { writeUsageCSV, writeMatrixCSV } from './csv.js';
import { buildGroupSummaries, filterSitesByScope } from './util.js';

/**
 * Process all matrix files and generate preference usage statistics
 * @param {Array} matrixFiles - Array of matrix file objects with {realm, matrixFile}
 * @returns {Promise<Array>} Array of summary objects with realm statistics
 */
export async function processPreferenceMatrixFiles(matrixFiles) {
    const summary = [];

    for (const { realm, matrixFile } of matrixFiles) {
        logProcessingRealm(realm);

        const csvData = parseCSVToNestedArray(matrixFile);

        if (csvData.length === 0) {
            logEmptyCSV();
            continue;
        }

        // Find unused preferences
        const unusedPreferences = findUnusedPreferences(csvData);

        // Write unused preferences to file
        const realmDir = path.dirname(matrixFile);
        const outputFile = writeUnusedPreferencesFile(realmDir, realm, unusedPreferences);

        const total = csvData.length - 1; // -1 for header
        logRealmResults(total, unusedPreferences.length, outputFile);

        summary.push({
            realm,
            total,
            unused: unusedPreferences.length,
            used: total - unusedPreferences.length
        });
    }

    return summary;
}

/**
 * Execute complete preference summarization workflow
 * @param {Object} params - Parameters object
 * @param {string} params.realm - Realm name
 * @param {string} params.objectType - Object type (e.g., 'SitePreferences')
 * @param {string} params.instanceType - Instance type (sandbox/production)
 * @param {string} params.scope - Scope (all/single)
 * @param {string} params.siteId - Site ID (if scope is single)
 * @param {boolean} params.includeDefaults - Include default values
 * @returns {Promise<Object>} Object with runtime and realm directory
 */
export async function executePreferenceSummarization(params) {
    const sandbox = getSandboxConfig(params.realm);

    console.log('\nFetching all preference definitions (attribute definitions)...');
    const preferenceDefinitions = await getSitePreferences(
        params.objectType,
        sandbox,
        params.includeDefaults
    );

    console.log('\nFetching preference groups (no assignments, just IDs)...');
    const groups = await getAttributeGroups(params.objectType, sandbox);
    const groupSummaries = buildGroupSummaries(groups);

    console.log('\nFetching sites and cartridge paths...');
    const sites = await getAllSites(sandbox);
    const sitesToProcess = filterSitesByScope(sites, params.scope, params.siteId);

    if (params.scope === 'single' && sitesToProcess.length === 0) {
        console.log(`No site found matching '${params.siteId}'. Aborting.`);
        return null;
    }

    const preferenceMeta = buildPreferenceMeta(preferenceDefinitions);
    const usageRows = [];

    console.log(`\nProcessing ${sitesToProcess.length} site(s)...`);

    const { usageRows: processedRows } = await processSitesAndGroups(
        sitesToProcess,
        groupSummaries,
        sandbox,
        params,
        preferenceMeta
    );

    usageRows.push(...processedRows);

    const realmDir = ensureRealmDir(params.realm);

    // Build complete preference matrix: all preferences vs all sites
    const allSiteIds = sitesToProcess.map(s => s.id || s.site_id || s.siteId).filter(Boolean).sort();
    const allPrefIds = Object.keys(preferenceMeta).sort();
    const preferenceMatrix = buildPreferenceMatrix(
        allPrefIds,
        allSiteIds,
        usageRows,
        preferenceMeta
    );

    // Write CSV with dynamic site-specific value columns
    writeUsageCSV(realmDir, params.realm, params.instanceType, usageRows, preferenceMeta);

    // Write matrix CSV: preferenceId vs sites (X marks usage)
    writeMatrixCSV(realmDir, params.realm, params.instanceType, preferenceMatrix, allSiteIds);

    return { realmDir, success: true };
}
