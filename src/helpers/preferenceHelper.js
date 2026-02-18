import path from 'path';
import fs from 'fs';
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
    logError,
    logStatusUpdate,
    logStatusClear,
    logRateLimitCountdown
} from './log.js';
import {
    getAttributeGroups,
    getAllSites,
    getSitePreferences,
    getAttributeDefinitionById
} from '../api.js';
import {
    buildPreferenceMeta,
    processSitesAndGroups,
    buildPreferenceMatrix
} from './summarize.js';
import { writeUsageCSV, writeMatrixCSV } from './csv.js';
import { buildGroupSummaries, filterSitesByScope } from './util.js';
import { processBatch, withLoadShedding } from './batch.js';
import { getApiConfig } from './constants.js';
import { checkBackupFileAge } from './preferenceBackup.js';
import { generate as generateSitePreferencesBackup } from './generateSitePreferencesJSON.js';
import { getMetadataBackupPathForRealm } from './backupJob.js';

/**
 * Check backup file status for multiple realms
 * @param {Array<string>} realms - List of realm names
 * @param {string} objectType - Object type (e.g., "SitePreferences")
 * @returns {Promise<Array<{realm: string, exists: boolean, ageInDays: number, filePath: string}>>}
 */
export async function checkBackupStatusForRealms(realms, objectType) {
    const { getSandboxConfig } = await import('../helpers.js');
    const results = [];

    for (const realm of realms) {
        const sandbox = getSandboxConfig(realm);
        const backupInfo = await checkBackupFileAge(realm, sandbox.instanceType, objectType);

        results.push({
            realm,
            exists: backupInfo.exists,
            ageInDays: backupInfo.ageInDays,
            filePath: backupInfo.filePath,
            tooOld: backupInfo.exists && backupInfo.ageInDays >= 14
        });
    }

    return results;
}

/**
 * Load backup file and return attributes
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @param {string} objectType - Object type
 * @returns {Promise<Array|null>} Attributes array or null if not found
 */
export async function loadCachedBackup(realm, instanceType, objectType) {
    const backupInfo = await checkBackupFileAge(realm, instanceType, objectType);

    if (!backupInfo.exists) {
        return null;
    }

    return backupInfo.backup.attributes;
}

/**
 * Fetch detailed attribute definitions with progress tracking
 * @param {Array} allAttributes - Basic attribute list
 * @param {string} objectType - Object type
 * @param {string} realm - Realm name
 * @param {Object} sandbox - Sandbox configuration
 * @returns {Promise<Array>} Detailed attribute definitions
 */
export async function fetchDetailedAttributes(allAttributes, objectType, realm, sandbox) {
    console.log('\nFetching full details with default values (parallel batches)...');
    const startTime = Date.now();
    const apiConfig = getApiConfig(sandbox.instanceType);

    const detailedAttributes = await withLoadShedding(
        async () => {
            return await processBatch(
                allAttributes,
                (attr) => getAttributeDefinitionById(objectType, attr.id, realm),
                apiConfig.batchSize,
                null,
                apiConfig.batchDelayMs
            );
        },
        {
            maxRetries: 2,
            onRetry: (attempt, delay) => {
                logRateLimitCountdown(delay, attempt, `batch of ${allAttributes.length} attributes`);
            }
        }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Completed fetching ${detailedAttributes.length} attributes with full details (${duration}s)`);

    return detailedAttributes;
}

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
        params.includeDefaults,
        params.useCachedBackup
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
 * Export preference analysis results to CSV files and generate backup
 * @param {string} realmDir - Realm directory path
 * @param {string} realm - Realm name
 * @param {Object} results - Results object with usageRows, allSiteIds, preferenceMatrix
 * @param {string} instanceType - Instance type
 * @param {string} objectType - Object type
 * @returns {Promise<string>} Path to usage CSV file
 * @private
 */
async function exportResults(realmDir, realm, results, instanceType, objectType) {
    const usageFilePath = writeUsageCSV(realmDir, realm, instanceType, results.usageRows, results.preferenceMeta);
    writeMatrixCSV(realmDir, realm, instanceType, results.preferenceMatrix, results.allSiteIds);

    const matrixFilePath = path.join(
        realmDir,
        `${realm}_${instanceType}_preferences_matrix.csv`
    );
    const matrixData = parseCSVToNestedArray(matrixFilePath);
    const unusedPreferences = findUnusedPreferences(matrixData);
    const unusedPreferencesFile = writeUnusedPreferencesFile(
        realmDir,
        realm,
        unusedPreferences
    );

    const backupDir = path.join(process.cwd(), 'backup', instanceType);
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupDate = new Date().toISOString().split('T')[0];
    const backupFilePath = path.join(
        backupDir,
        `${realm}_${objectType}_backup_${backupDate}.json`
    );
    const metadataPath = getMetadataBackupPathForRealm(realm, instanceType);

    await generateSitePreferencesBackup({
        unusedPreferencesFile,
        csvFile: usageFilePath,
        xmlMetadataFile: metadataPath,
        outputFile: backupFilePath,
        realm,
        instanceType,
        objectType,
        verbose: true
    });

    return usageFilePath;
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
 * @param {string} [params.repositoryPath] - Optional local repository path for meta.xml parsing
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
    await exportResults(
        realmDir,
        params.realm,
        results,
        params.instanceType,
        params.objectType
    );

    logStatusClear();
    return { realmDir, success: true };
}
