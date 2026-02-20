import path from 'path';
import {
    parseCSVToNestedArray,
    findUnusedPreferences,
    writeUnusedPreferencesFile
} from '../io/csv.js';
import { ensureRealmDir } from '../io/util.js';
import { FILE_PATTERNS } from '../config/constants.js';
import {
    logProcessingRealm,
    logEmptyCSV,
    logRealmResults,
    logError,
    logStatusUpdate,
    logStatusClear
} from '../scripts/loggingScript/log.js';
import {
    getAttributeGroups,
    getAllSites,
    getSitePreferences
} from '../api/api.js';
import {
    buildPreferenceMeta,
    processSitesAndGroups,
    buildPreferenceMatrix
} from './summarize.js';
import { writeUsageCSV, writeMatrixCSV } from '../io/csv.js';
import { buildGroupSummaries, filterSitesByScope } from '../io/util.js';
import { RealmProgressDisplay } from '../scripts/loggingScript/progressDisplay.js';

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
 * @param {Object} [progressInfo] - Progress tracking info
 * @param {RealmProgressDisplay} [progressInfo.display] - Progress display instance
 * @param {string} [progressInfo.hostname] - Realm hostname for progress tracking
 * @param {string} [progressInfo.realmName] - Realm display name
 * @returns {Promise<Object>} Object with preferenceDefinitions, groups, groupSummaries, sites
 * @private
 */
async function fetchPreferenceData(params, progressInfo) {
    const display = progressInfo?.display;
    const hostname = progressInfo?.hostname;
    const realmName = progressInfo?.realmName;

    if (display && hostname && realmName) {
        display.startStep(hostname, realmName, 'fetch', 'Fetching Preferences');
    } else {
        console.log('\nFetching all preference definitions (attribute definitions)...');
    }

    let fetchCompleted = false;
    let detailsStarted = false;

        // Create progress callback for first fetch (attributes pagination)
        // Maps pagination progress (0 to totalAttributes) to 0-100% of fetch step
        const attributeProgressCallback = (currentCount, totalCount) => {
            if (display && hostname && totalCount > 0) {
                const percentage = Math.round((currentCount / totalCount) * 100);
                display.setStepProgress(hostname, 'fetch', percentage);
                if (currentCount >= totalCount && !fetchCompleted) {
                    display.completeStep(hostname, 'fetch');
                    fetchCompleted = true;
                }
            }
        };

        const detailProgressCallback = (currentCount, totalCount) => {
            if (display && hostname && realmName && totalCount > 0) {
                if (!detailsStarted) {
                    display.startStep(hostname, realmName, 'details', 'Retrieving Attribute Definitions');
                    detailsStarted = true;
                }
                const percentage = Math.round((currentCount / totalCount) * 100);
                display.setStepProgress(hostname, 'details', percentage);
                if (currentCount >= totalCount) {
                    display.completeStep(hostname, 'details');
                }
            }
        };

        const preferenceDefinitions = await getSitePreferences(
            params.objectType,
            params.realm,
            params.includeDefaults,
            params.useCachedBackup,
            attributeProgressCallback,
            detailProgressCallback,
            { display, hostname }
        );

        if (display && hostname && !fetchCompleted) {
            display.completeStep(hostname, 'fetch');
            fetchCompleted = true;
        }

        if (display && hostname && realmName && params.includeDefaults && !detailsStarted) {
            display.startStep(hostname, realmName, 'details', 'Retrieving Attribute Definitions');
            display.completeStep(hostname, 'details');
        }

        if (display && hostname && realmName) {
            display.startStep(hostname, realmName, 'groups', 'Fetching Attribute Groups');
        }

        const groupProgressCallback = (currentCount, totalCount) => {
            if (display && hostname && totalCount > 0) {
                const percentage = Math.round((currentCount / totalCount) * 100);
                display.setStepProgress(hostname, 'groups', percentage);
            }
        };

        const groups = await getAttributeGroups(
            params.objectType, params.realm, groupProgressCallback,
            display && hostname ? { display, hostname, stepKey: 'groups' } : null
        );
        const groupSummaries = buildGroupSummaries(groups);

        if (display && hostname) {
            display.completeStep(hostname, 'groups');
        }

        const sites = await getAllSites(params.realm,
            display && hostname ? { display, hostname, stepKey: 'groups' } : null
        );

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
 * @param {Object} [progressInfo] - Progress tracking info
 * @param {RealmProgressDisplay} [progressInfo.display] - Progress display instance
 * @param {string} [progressInfo.hostname] - Realm hostname for progress tracking
 * @param {string} [progressInfo.realmName] - Realm display name
 * @returns {Promise<Object>} Object with usageRows, allSiteIds, preferenceMatrix
 * @private
 */
async function buildPreferenceMatrices(data, realm, params, progressInfo) {
    const display = progressInfo?.display;
    const hostname = progressInfo?.hostname;
    const realmName = progressInfo?.realmName;

    if (display && hostname && realmName) {
        display.startStep(hostname, realmName, 'matrices', 'Building Matrices');
    } else if (!display) {
        console.log(`\nProcessing ${data.sitesToProcess.length} site(s)...`);
    }

    const preferenceMeta = buildPreferenceMeta(data.preferenceDefinitions);

    // Create progress callback for site processing (0-80% of matrices step)
    const siteProgressCallback = (currentSite, totalSites) => {
            if (display && hostname && totalSites > 0) {
                const percentage = Math.round((currentSite / totalSites) * 80);
                display.setStepProgress(hostname, 'matrices', percentage);
            }
        };

        const matricesProgressInfo = display && hostname
            ? { display, hostname, stepKey: 'matrices' }
            : null;

        const { usageRows: processedRows } = await processSitesAndGroups(
            data.sitesToProcess,
            data.groupSummaries,
            realm,
            params,
            preferenceMeta,
            siteProgressCallback,
            matricesProgressInfo
        );

        if (display && hostname) {
            display.setStepProgress(hostname, 'matrices', 90);
        }

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

        if (display && hostname) {
            display.completeStep(hostname, 'matrices');
        }

        return { usageRows: processedRows, allSiteIds, preferenceMatrix, preferenceMeta };
}

/**
 * Export preference analysis results to CSV files
 * @param {string} realmDir - Realm directory path
 * @param {string} realm - Realm name
 * @param {Object} results - Results object with usageRows, allSiteIds, preferenceMatrix
 * @param {string} instanceType - Instance type
 * @param {string} _objectType - Object type (unused)
 * @param {Object} [progressInfo] - Progress tracking info
 * @param {RealmProgressDisplay} [progressInfo.display] - Progress display instance
 * @param {string} [progressInfo.hostname] - Realm hostname for progress tracking
 * @param {string} [progressInfo.realmName] - Realm display name
 * @returns {Promise<string>} Path to usage CSV file
 * @private
 */
async function exportResults(realmDir, realm, results, instanceType, _objectType, progressInfo) {
    const display = progressInfo?.display;
    const hostname = progressInfo?.hostname;
    const realmName = progressInfo?.realmName;

    if (display && hostname && realmName) {
        display.startStep(hostname, realmName, 'export', 'Exporting Results');
    }

    const usageFilePath = writeUsageCSV(realmDir, realm, instanceType, results.usageRows, results.preferenceMeta);
    writeMatrixCSV(realmDir, realm, instanceType, results.preferenceMatrix, results.allSiteIds);

    if (display && hostname) {
        display.setStepProgress(hostname, 'export', 60);
    }

    const matrixFilePath = path.join(
        realmDir,
        `${realm}_${instanceType}${FILE_PATTERNS.PREFERENCES_MATRIX}`
    );
    const matrixData = parseCSVToNestedArray(matrixFilePath);
    const unusedPreferences = findUnusedPreferences(matrixData);
    writeUnusedPreferencesFile(
        realmDir,
        realm,
        unusedPreferences
    );

    if (display && hostname) {
        display.completeStep(hostname, 'export');
    }

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
 * @param {Object} [progressInfo] - Progress tracking info
 * @param {RealmProgressDisplay} [progressInfo.display] - Progress display instance
 * @param {string} [progressInfo.hostname] - Realm hostname for progress tracking
 * @param {string} [progressInfo.realmName] - Realm display name
 * @returns {Promise<Object>} Object with realmDir and success flag
 */
export async function executePreferenceSummarization(params, progressInfo) {
    if (!progressInfo?.display) {
        logStatusUpdate(`Fetching preferences for ${params.realm}`);
    }

    const realmDir = ensureRealmDir(params.realm);

    // Suppress console output for entire workflow when progress display is active
    const originalLog = console.log;
    if (progressInfo?.display && progressInfo?.hostname) {
        console.log = () => {};
    }

    try {
        const apiData = await fetchPreferenceData(params, progressInfo);
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

        const results = await buildPreferenceMatrices(processData, params.realm, params, progressInfo);
        await exportResults(
            realmDir,
            params.realm,
            results,
            params.instanceType,
            params.objectType,
            progressInfo
        );

        if (!progressInfo?.display) {
            logStatusClear();
        }

        return { realmDir, success: true };
    } finally {
        // Always restore console.log
        if (progressInfo?.display && progressInfo?.hostname) {
            console.log = originalLog;
        }
    }
}
