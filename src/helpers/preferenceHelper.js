import path from 'path';
import {
    parseCSVToNestedArray,
    findUnusedPreferences,
    writeUnusedPreferencesFile,
    ensureRealmDir
} from '../helpers.js';
import {
    logProcessingRealm,
    logEmptyCSV,
    logRealmResults,
    logError
} from './log.js';
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
import { logStatusUpdate, logStatusClear } from './log.js';

/**
 * Process a single matrix file and extract unused preferences
 * @param {string} realm - Realm name
 * @param {string} matrixFile - Path to matrix file
 * @returns {Promise<Object|null>} Summary object or null if processing failed
 * @private
 */
async function processMatrixFile(realm, matrixFile) {
    const csvData = parseCSVToNestedArray(matrixFile);
    const realmDir = path.dirname(matrixFile);

    if (csvData.length === 0) {
        logEmptyCSV();
        return null;
    }

    const unusedPreferences = findUnusedPreferences(csvData);
    const outputFile = writeUnusedPreferencesFile(realmDir, realm, unusedPreferences);
    const total = csvData.length - 1; // -1 for header

    logRealmResults(total, unusedPreferences.length, outputFile);

    return {
        realm,
        total,
        unused: unusedPreferences.length,
        used: total - unusedPreferences.length
    };
}

/**
 * Process all matrix files and generate preference usage statistics
 * @param {Array} matrixFiles - Array of matrix file objects with {realm, matrixFile}
 * @returns {Promise<Array>} Array of summary objects with realm statistics
 */
export async function processPreferenceMatrixFiles(matrixFiles) {
    const summary = [];

    for (const { realm, matrixFile } of matrixFiles) {
        logProcessingRealm(realm);

        const result = await processMatrixFile(realm, matrixFile);
        if (result) {
            summary.push(result);
        }
    }

    return summary;
}

/**
 * Fetch initial preference data from API
 * @param {Object} params - Parameters object
 * @returns {Promise<Object>} Object with preferenceDefinitions, groups, groupSummaries, sites
 * @private
 */
async function fetchPreferenceData(params) {
    console.log('\nFetching all preference definitions (attribute definitions)...');
    const preferenceDefinitions = await getSitePreferences(
        params.objectType,
        params.realm,
        params.includeDefaults
    );

    console.log('\nFetching preference groups (no assignments, just IDs)...');
    const groups = await getAttributeGroups(params.objectType, params.realm);
    const groupSummaries = buildGroupSummaries(groups);

    console.log('\nFetching sites and cartridge paths...');
    const sites = await getAllSites(params.realm);

    return { preferenceDefinitions, groups, groupSummaries, sites };
}

/**
 * Filter sites based on scope and validate selection
 * @param {Array} sites - All available sites
 * @param {string} scope - Scope value (all/single)
 * @param {string} siteId - Site ID for single scope
 * @returns {Array|null} Filtered sites or null if validation fails
 * @private
 */
function validateAndFilterSites(sites, scope, siteId) {
    const sitesToProcess = filterSitesByScope(sites, scope, siteId);

    if (scope === 'single' && sitesToProcess.length === 0) {
        const message = `No site found matching '${siteId}'. Aborting.`;
        logError(message);
        return null;
    }

    return sitesToProcess;
}

/**
 * Process site data and build preference matrices
 * @param {Object} data - Data object containing sites, preferences, groups
 * @param {string} realm - Realm name
 * @param {Object} params - Parameters object
 * @returns {Promise<Object>} Object with usageRows, allSiteIds, preferenceMatrix
 * @private
 */
async function buildPreferenceMatrices(data, realm, params) {
    const preferenceMeta = buildPreferenceMeta(data.preferenceDefinitions);

    console.log(`\nProcessing ${data.sitesToProcess.length} site(s)...`);

    const { usageRows: processedRows } = await processSitesAndGroups(
        data.sitesToProcess,
        data.groupSummaries,
        realm,
        params,
        preferenceMeta
    );

    const allSiteIds = data.sitesToProcess
        .map(s => s.id || s.site_id || s.siteId)
        .filter(Boolean)
        .sort();

    const allPrefIds = Object.keys(preferenceMeta).sort();
    const preferenceMatrix = buildPreferenceMatrix(
        allPrefIds,
        allSiteIds,
        processedRows,
        preferenceMeta
    );

    return { usageRows: processedRows, allSiteIds, preferenceMatrix, preferenceMeta };
}

/**
 * Export preference analysis results to CSV files
 * @param {string} realmDir - Realm directory path
 * @param {string} realm - Realm name
 * @param {Object} results - Results object with usageRows, allSiteIds, preferenceMatrix
 * @param {string} instanceType - Instance type
 * @private
 */
function exportResults(realmDir, realm, results, instanceType) {
    writeUsageCSV(realmDir, realm, instanceType, results.usageRows, results.preferenceMeta);
    writeMatrixCSV(realmDir, realm, instanceType, results.preferenceMatrix, results.allSiteIds);
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
 * @returns {Promise<Object>} Object with realmDir and success flag
 */
export async function executePreferenceSummarization(params) {
    logStatusUpdate(`Fetching preferences for ${params.realm}`);

    const realmDir = ensureRealmDir(params.realm);

    const apiData = await fetchPreferenceData(params);
    const sitesToProcess = validateAndFilterSites(
        apiData.sites,
        params.scope,
        params.siteId
    );

    if (!sitesToProcess) {
        return null;
    }

    const processData = {
        ...apiData,
        sitesToProcess
    };

    const results = await buildPreferenceMatrices(processData, params.realm, params);
    exportResults(realmDir, params.realm, results, params.instanceType);

    logStatusClear();
    return { realmDir, success: true };
}
