import path from 'path';
import {
    parseCSVToNestedArray,
    findUnusedPreferences,
    writeUnusedPreferencesFile,
    ensureRealmDir
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
        const csvData = parseCSVToNestedArray(matrixFile);
        const realmDir = path.dirname(matrixFile);
        let unusedPreferences = [];
        let outputFile = '';
        let total = 0;

        logProcessingRealm(realm);

        if (csvData.length === 0) {
            logEmptyCSV();
            continue;
        }

        // Find unused preferences
        unusedPreferences = findUnusedPreferences(csvData);

        // Write unused preferences to file
        outputFile = writeUnusedPreferencesFile(realmDir, realm, unusedPreferences);

        total = csvData.length - 1; // -1 for header
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
    let preferenceDefinitions = [];
    let groups = [];
    let groupSummaries = [];
    let sites = [];
    let sitesToProcess = [];
    let preferenceMeta = {};
    const usageRows = [];
    const realmDir = ensureRealmDir(params.realm);
    let allSiteIds = [];
    let allPrefIds = [];
    let preferenceMatrix = [];

    console.log('\nFetching all preference definitions (attribute definitions)...');
    preferenceDefinitions = await getSitePreferences(
        params.objectType,
        params.realm,
        params.includeDefaults
    );

    console.log('\nFetching preference groups (no assignments, just IDs)...');
    groups = await getAttributeGroups(params.objectType, params.realm);
    groupSummaries = buildGroupSummaries(groups);

    console.log('\nFetching sites and cartridge paths...');
    sites = await getAllSites(params.realm);
    sitesToProcess = filterSitesByScope(sites, params.scope, params.siteId);

    if (params.scope === 'single' && sitesToProcess.length === 0) {
        console.log(`No site found matching '${params.siteId}'. Aborting.`);
        return null;
    }

    preferenceMeta = buildPreferenceMeta(preferenceDefinitions);

    console.log(`\nProcessing ${sitesToProcess.length} site(s)...`);

    const { usageRows: processedRows } = await processSitesAndGroups(
        sitesToProcess,
        groupSummaries,
        params.realm,
        params,
        preferenceMeta
    );

    usageRows.push(...processedRows);

    // Build complete preference matrix: all preferences vs all sites
    allSiteIds = sitesToProcess.map(s => s.id || s.site_id || s.siteId).filter(Boolean).sort();
    allPrefIds = Object.keys(preferenceMeta).sort();
    preferenceMatrix = buildPreferenceMatrix(
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
