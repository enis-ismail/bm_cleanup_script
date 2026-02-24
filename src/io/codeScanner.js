
import fs from 'fs';
import path from 'path';
import { setImmediate } from 'timers/promises';
import { findAllMatrixFiles } from './util.js';
import { ensureResultsDir } from './util.js';
import { parseCSVToNestedArray } from './csv.js';
import { logStatusUpdate, logStatusClear, logProgress } from '../scripts/loggingScript/log.js';
import {
    DIRECTORIES,
    IDENTIFIERS,
    FILE_PATTERNS,
    ALLOWED_EXTENSIONS,
    SKIP_DIRECTORIES
} from '../config/constants.js';
import { filterBlacklisted, loadBlacklist } from '../helpers/blacklistHelper.js';

const DEFAULT_COMPARISON_FILE_PATH = path.join(
    process.cwd(),
    DIRECTORIES.RESULTS,
    IDENTIFIERS.ALL_REALMS,
    `${IDENTIFIERS.ALL_REALMS}${FILE_PATTERNS.CARTRIDGE_COMPARISON}`
);

function getDeprecatedCartridges(comparisonFilePath) {
    const deprecatedCartridges = new Set();
    let content = '';
    let inDeprecatedSection = false;

    if (!comparisonFilePath || !fs.existsSync(comparisonFilePath)) {
        return deprecatedCartridges;
    }

    content = fs.readFileSync(comparisonFilePath, 'utf-8');

    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        if (line.includes('--- Potentially Deprecated Cartridges ---')) {
            inDeprecatedSection = true;
            continue;
        }

        if (line.includes('--- Active Cartridges ---')) {
            inDeprecatedSection = false;
            break;
        }

        if (inDeprecatedSection) {
            const match = line.match(/\[X\]\s+([^\s]+)/);
            if (match && match[1]) {
                deprecatedCartridges.add(match[1]);
            }
        }
    }

    return deprecatedCartridges;
}

function getCartridgeNameFromPath(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const cartridgesIndex = normalizedPath.indexOf('/cartridges/');
    const cartridgeIndex = normalizedPath.indexOf('/cartridge/');

    if (cartridgesIndex !== -1) {
        const afterCartridges = normalizedPath.slice(cartridgesIndex + '/cartridges/'.length);
        const name = afterCartridges.split('/')[0];
        return name || null;
    }

    if (cartridgeIndex !== -1) {
        const beforeCartridge = normalizedPath.slice(0, cartridgeIndex);
        const parts = beforeCartridge.split('/');
        const name = parts[parts.length - 1];
        return name || null;
    }

    return null;
}

function shouldSkipDirectory(name) {
    return name.startsWith('.') || SKIP_DIRECTORIES.has(name);
}

function shouldScanFile(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return ALLOWED_EXTENSIONS.has(extension);
}

function countScannableFiles(dirPath) {
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (shouldSkipDirectory(entry.name)) {
                continue;
            }
            total += countScannableFiles(entryPath);
            continue;
        }

        if (shouldScanFile(entryPath)) {
            total += 1;
        }
    }

    return total;
}

function collectMatchesInFile(filePath, preferenceId) {
    const matches = [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.includes(preferenceId)) {
            matches.push({
                filePath,
                lineNumber: i + 1,
                lineText: line.trim()
            });
        }
    }

    return matches;
}

function collectAllFilePaths(dirPath, fileList = []) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (shouldSkipDirectory(entry.name)) {
                continue;
            }
            collectAllFilePaths(entryPath, fileList);
            continue;
        }

        if (!shouldScanFile(entryPath)) {
            continue;
        }

        const cartridgeName = getCartridgeNameFromPath(entryPath);

        fileList.push({ path: entryPath, cartridge: cartridgeName });
    }

    return fileList;
}

function searchMultiplePreferencesInFile(filePath, preferenceIds) {
    const foundPreferences = new Set();

    try {
        const content = fs.readFileSync(filePath, 'utf-8');

        for (const prefId of preferenceIds) {
            if (content.includes(prefId)) {
                foundPreferences.add(prefId);
            }
        }
    } catch {
        // Ignore unreadable/binary files
    }

    return foundPreferences;
}

function searchDirectoryForPreference(dirPath, preferenceId, deprecatedCartridges, matches, state, isFirstSearch) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (shouldSkipDirectory(entry.name)) {
                continue;
            }
            searchDirectoryForPreference(entryPath, preferenceId, deprecatedCartridges, matches, state, isFirstSearch);
            continue;
        }

        if (!shouldScanFile(entryPath)) {
            continue;
        }

        state.scannedFiles += 1;

        const cartridgeName = getCartridgeNameFromPath(entryPath);
        const isDeprecated = cartridgeName && deprecatedCartridges.has(cartridgeName);

        if (isDeprecated) {
            continue;
        }

        try {
            const fileMatches = collectMatchesInFile(entryPath, preferenceId);
            matches.push(...fileMatches);
            state.matchesFound += fileMatches.length;
            logProgress(state, isFirstSearch);
        } catch {
            // Ignore unreadable/binary files
        }
    }
}

/**
 * Get all active preferences from matrix CSV files
 * @param {Array<string>} matrixFilePaths - Array of matrix file paths
 * @returns {Set<string>} Set of unique active preference IDs
 */
export function getActivePreferencesFromMatrices(matrixFilePaths) {
    const activePreferences = new Set();

    for (const filePath of matrixFilePaths) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split(/\r?\n/);

            if (lines.length < 2) {
                continue;
            }

            const headers = lines[0].split(',');
            const preferenceIdIndex = headers.indexOf('preferenceId');

            if (preferenceIdIndex === -1) {
                continue;
            }

            // Iterate through data rows starting from line 1
            for (let i = 1; i < lines.length; i += 1) {
                const line = lines[i].trim();
                if (!line) {
                    continue;
                }

                const parts = line.split(',');
                if (parts.length > preferenceIdIndex) {
                    let prefId = parts[preferenceIdIndex].trim();
                    // Remove surrounding quotes from CSV fields
                    if (prefId.startsWith('"') && prefId.endsWith('"')) {
                        prefId = prefId.slice(1, -1);
                    }
                    if (prefId) {
                        activePreferences.add(prefId);
                    }
                }
            }
        } catch {
            // Ignore unreadable files
        }
    }

    return activePreferences;
}

/**
 * Export unused preferences (with no cartridge usage) to a separate file
 * @param {Array} results - Array of preference usage results
 * @param {string} [instanceTypeOverride] - Optional instance type for output path scoping
 * @returns {string} Path to the exported file
 */
function exportUnusedPreferencesToFile(results, instanceTypeOverride = null) {
    const unusedPreferences = results.filter(r => r.cartridges.length === 0);

    if (unusedPreferences.length === 0) {
        return null;
    }

    const dirName = instanceTypeOverride || IDENTIFIERS.ALL_REALMS;
    const resultsDir = ensureResultsDir(IDENTIFIERS.ALL_REALMS, instanceTypeOverride);
    const filename = `${dirName}${FILE_PATTERNS.UNUSED_PREFERENCES}`;
    const filePath = path.join(resultsDir, filename);

    const lines = [
        'Unused Preferences (Not Referenced in Any Cartridge)',
        `Generated: ${new Date().toISOString()}`,
        `Total Unused: ${unusedPreferences.length}`,
        '',
        '--- Preference IDs ---',
        ...unusedPreferences.map(p => p.preferenceId)
    ];

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

    return filePath;
}

/**
 * Export cartridge-to-preferences mapping to a text file
 * @param {Array} results - Array of preference usage results
 * @param {string} [instanceTypeOverride] - Optional instance type for output path scoping
 * @returns {string} Path to the exported file
 */
function exportCartridgePreferenceMapping(results, instanceTypeOverride = null) {
    // Build a map of cartridge -> preferences
    const cartridgeToPreferences = new Map();

    for (const result of results) {
        for (const cartridge of result.cartridges) {
            // Extract cartridge name (remove [possibly deprecated] tag if present)
            const cartridgeName = cartridge.replace(' [possibly deprecated]', '');
            const isDeprecated = cartridge.includes('[possibly deprecated]');

            if (!cartridgeToPreferences.has(cartridgeName)) {
                cartridgeToPreferences.set(cartridgeName, {
                    preferences: new Set(),
                    isDeprecated
                });
            }

            cartridgeToPreferences.get(cartridgeName).preferences.add(result.preferenceId);
        }
    }

    // Sort cartridges alphabetically
    const sortedCartridges = Array.from(cartridgeToPreferences.keys()).sort();

    const dirName = instanceTypeOverride || IDENTIFIERS.ALL_REALMS;
    const resultsDir = ensureResultsDir(IDENTIFIERS.ALL_REALMS, instanceTypeOverride);
    const filename = `${dirName}${FILE_PATTERNS.CARTRIDGE_PREFERENCES}`;
    const filePath = path.join(resultsDir, filename);

    const lines = [
        'Cartridge Preference Usage',
        `Generated: ${new Date().toISOString()}`,
        `Total Cartridges: ${sortedCartridges.length}`,
        '',
        '================================================================================',
        ''
    ];

    for (const cartridgeName of sortedCartridges) {
        const data = cartridgeToPreferences.get(cartridgeName);
        const deprecatedTag = data.isDeprecated ? ' [possibly deprecated]' : '';
        const preferences = Array.from(data.preferences).sort();

        lines.push(`Cartridge: ${cartridgeName}${deprecatedTag}`);
        lines.push(`  Preferences Used: ${preferences.length}`);

        if (preferences.length === 0) {
            lines.push('  (no preferences found)');
        } else {
            preferences.forEach(pref => {
                lines.push(`    • ${pref}`);
            });
        }

        lines.push('');
    }

    lines.push('================================================================================');
    lines.push(`Total cartridges: ${sortedCartridges.length}`);
    lines.push(`Total unique preferences used: ${results.filter(r => r.cartridges.length > 0).length}`);

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

    return filePath;
}

/**
 * Parse unused preferences file and extract preference IDs
 * @param {string} filePath - Path to unused preferences file
 * @returns {Set<string>} Set of unused preference IDs
 */
function parseUnusedPreferencesFile(filePath) {
    const unusedPrefs = new Set();

    if (!fs.existsSync(filePath)) {
        return unusedPrefs;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    let inPreferenceSection = false;

    for (const line of lines) {
        if (line.trim() === '--- Preference IDs ---') {
            inPreferenceSection = true;
            continue;
        }

        if (inPreferenceSection && line.trim()) {
            unusedPrefs.add(line.trim());
        }
    }

    return unusedPrefs;
}

/**
 * Parse cartridge preferences file and extract all used preference IDs
 * @param {string} filePath - Path to cartridge preferences file
 * @returns {Set<string>} Set of used preference IDs
 */
function parseCartridgePreferencesFile(filePath) {
    const usedPrefs = new Set();

    if (!fs.existsSync(filePath)) {
        return usedPrefs;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        // Look for lines that start with bullet points (preferences)
        const match = line.match(/^\s+•\s+(.+)$/);
        if (match && match[1]) {
            usedPrefs.add(match[1].trim());
        }
    }

    return usedPrefs;
}

/**
 * Build a map of preference value data from matrix CSV files
 * @param {string|null} instanceTypeOverride - Instance type for matrix file scoping
 * @returns {Map<string, {hasValues: boolean, hasDefault: boolean, siteCount: number}>}
 */
function buildPreferenceValueMap(instanceTypeOverride = null) {
    const valueMap = new Map();
    const matrixFiles = findAllMatrixFiles();

    for (const { matrixFile } of matrixFiles) {
        // Filter by instance type if specified
        if (instanceTypeOverride) {
            const normalizedPath = matrixFile.replace(/\\/g, '/');
            if (!normalizedPath.includes(`/${instanceTypeOverride}/`)) {
                continue;
            }
        }

        const csvData = parseCSVToNestedArray(matrixFile);

        if (csvData.length <= 1) {
            continue;
        }

        const headers = csvData[0];
        const preferenceIdIndex = headers.indexOf('preferenceId');
        const defaultValueIndex = headers.indexOf('defaultValue');

        if (preferenceIdIndex === -1) {
            continue;
        }

        const siteDataStart = defaultValueIndex > -1 ? defaultValueIndex + 1 : 1;

        for (let i = 1; i < csvData.length; i++) {
            const row = csvData[i];
            const preferenceId = row[preferenceIdIndex];

            if (!preferenceId) {
                continue;
            }

            const defaultValue = defaultValueIndex > -1 ? (row[defaultValueIndex] || '') : '';
            const hasDefault = defaultValue.trim() !== '';
            const sitesWithValues = row.slice(siteDataStart)
                .filter(v => v === 'X' || v === 'x').length;
            const hasValues = sitesWithValues > 0;

            // Merge across realms: if ANY realm has values/defaults, record it
            const existing = valueMap.get(preferenceId);
            if (existing) {
                existing.hasValues = existing.hasValues || hasValues;
                existing.hasDefault = existing.hasDefault || hasDefault;
                existing.siteCount = existing.siteCount + sitesWithValues;
            } else {
                valueMap.set(preferenceId, { hasValues, hasDefault, siteCount: sitesWithValues });
            }
        }
    }

    return valueMap;
}

/**
 * Compare unused and cartridge preferences files, classify using code scan results,
 * and generate priority-ranked deletion candidates.
 *
 * Priority tiers:
 *   [P1] No code references, no values / defaults         — safest to remove
 *   [P2] No code references, but has values / defaults     — likely safe, verify values
 *   [P3] Only in deprecated cartridges, no values          — probably safe
 *   [P4] Only in deprecated cartridges, has values         — needs careful review
 *
 * @param {string|null} instanceTypeOverride - Optional instance type for output path scoping
 * @param {Array} [codeResults] - Results from findAllActivePreferencesUsage (enriched)
 * @returns {string|null} Path to the generated file, or null if no candidates found
 */
export function generatePreferenceDeletionCandidates(instanceTypeOverride = null, codeResults = []) {
    const dirName = instanceTypeOverride || IDENTIFIERS.ALL_REALMS;
    const resultsDir = ensureResultsDir(IDENTIFIERS.ALL_REALMS, instanceTypeOverride);

    const unusedFilePath = path.join(resultsDir, `${dirName}${FILE_PATTERNS.UNUSED_PREFERENCES}`);
    const cartridgeFilePath = path.join(
        resultsDir, `${dirName}${FILE_PATTERNS.CARTRIDGE_PREFERENCES}`
    );

    // Check if both files exist
    if (!fs.existsSync(unusedFilePath)) {
        console.log(`\u26a0 Unused preferences file not found: ${unusedFilePath}`);
        return null;
    }

    if (!fs.existsSync(cartridgeFilePath)) {
        console.log(`\u26a0 Cartridge preferences file not found: ${cartridgeFilePath}`);
        return null;
    }

    // Parse both files
    const unusedPreferences = parseUnusedPreferencesFile(unusedFilePath);
    const usedPreferences = parseCartridgePreferencesFile(cartridgeFilePath);

    // Build code usage lookup from enriched results
    const codeUsageMap = new Map();
    for (const result of codeResults) {
        codeUsageMap.set(result.preferenceId, {
            activeCartridges: result.activeCartridges || [],
            deprecatedCartridges: result.deprecatedCartridges || []
        });
    }

    // Build value/default lookup from matrix CSVs
    const valueMap = buildPreferenceValueMap(instanceTypeOverride);

    // Classify ALL preferences into tiers
    const p1 = []; // No code, no values
    const p2 = []; // No code, has values
    const p3 = []; // Deprecated code only, no values
    const p4 = []; // Deprecated code only, has values

    // Set of all candidate preference IDs (for blacklist filtering later)
    const allCandidateIds = new Set();

    // --- Tier 1 & 2: Preferences with NO code references ---
    // These are in "unused" (no cartridge code refs) and not in "used"
    for (const prefId of unusedPreferences) {
        if (usedPreferences.has(prefId)) {
            continue;
        }

        allCandidateIds.add(prefId);
        const valData = valueMap.get(prefId) || { hasValues: false, hasDefault: false, siteCount: 0 };

        if (valData.hasValues || valData.hasDefault) {
            p2.push({ id: prefId, ...valData });
        } else {
            p1.push({ id: prefId });
        }
    }

    // --- Tier 3 & 4: Preferences ONLY in deprecated cartridges ---
    // These have code refs, but ALL refs are in deprecated cartridges
    for (const [prefId, usage] of codeUsageMap) {
        // Skip if already classified (no code refs)
        if (allCandidateIds.has(prefId)) {
            continue;
        }

        // Skip if there are active (non-deprecated) cartridge references
        if (usage.activeCartridges.length > 0) {
            continue;
        }

        // Only deprecated cartridge references exist
        if (usage.deprecatedCartridges.length > 0) {
            allCandidateIds.add(prefId);
            const valData = valueMap.get(prefId)
                || { hasValues: false, hasDefault: false, siteCount: 0 };

            if (valData.hasValues || valData.hasDefault) {
                p4.push({
                    id: prefId,
                    deprecatedCartridges: usage.deprecatedCartridges,
                    ...valData
                });
            } else {
                p3.push({
                    id: prefId,
                    deprecatedCartridges: usage.deprecatedCartridges
                });
            }
        }
    }

    // Sort each tier alphabetically
    p1.sort((a, b) => a.id.localeCompare(b.id));
    p2.sort((a, b) => a.id.localeCompare(b.id));
    p3.sort((a, b) => a.id.localeCompare(b.id));
    p4.sort((a, b) => a.id.localeCompare(b.id));

    // Apply blacklist filter to all candidates
    const allCandidateArray = [...p1, ...p2, ...p3, ...p4].map(c => c.id);
    const blacklistEntries = loadBlacklist().blacklist;
    const { blocked: blacklistedPreferences } = filterBlacklisted(allCandidateArray, blacklistEntries);
    const blacklistedSet = new Set(blacklistedPreferences);

    // Remove blacklisted from each tier
    const filterBlacklisted_ = (arr) => arr.filter(c => !blacklistedSet.has(c.id));
    const fp1 = filterBlacklisted_(p1);
    const fp2 = filterBlacklisted_(p2);
    const fp3 = filterBlacklisted_(p3);
    const fp4 = filterBlacklisted_(p4);

    const totalCandidates = fp1.length + fp2.length + fp3.length + fp4.length;

    if (blacklistedPreferences.length > 0) {
        console.log(
            `\u2713 Blacklist protected ${blacklistedPreferences.length} preference(s) from deletion`
        );
    }

    if (totalCandidates === 0) {
        console.log(
            '\u2713 No preferences marked for deletion (all unused preferences have some usage)'
        );
        return null;
    }

    // Generate output file
    const outputFilename = `${dirName}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`;
    const outputFilePath = path.join(resultsDir, outputFilename);

    const lines = [
        'Site Preferences \u2014 Deletion Candidates (Priority Ranked)',
        `Generated: ${new Date().toISOString()}`,
        '',
        'Analysis Summary:',
        `  \u2022 Total preferences analyzed: ${codeResults.length || unusedPreferences.size + usedPreferences.size}`,
        `  \u2022 [P1] Safe to delete (no code, no values): ${fp1.length}`,
        `  \u2022 [P2] Likely safe (no code, has values): ${fp2.length}`,
        `  \u2022 [P3] Review: deprecated code only, no values: ${fp3.length}`,
        `  \u2022 [P4] Review: deprecated code only, has values: ${fp4.length}`,
        `  \u2022 Total deletion candidates: ${totalCandidates}`
    ];

    if (blacklistedPreferences.length > 0) {
        lines.push(`  \u2022 Blacklisted (protected): ${blacklistedPreferences.length}`);
    }

    lines.push(
        '',
        'Priority Legend:',
        '  [P1] No code references, no values \u2014 safest to remove',
        '  [P2] No code references, but has values/defaults \u2014 likely unused but verify',
        '  [P3] Only in deprecated cartridges, no values \u2014 probably safe',
        '  [P4] Only in deprecated cartridges, has values \u2014 needs careful review',
        '',
        'NOTE: Preferences matching patterns in preference_blacklist.json are excluded',
        'from this list and will never be deleted. To manage the blacklist, run:',
        '  \u2022 node src/main.js list-blacklist        \u2014 View all protected patterns',
        '  \u2022 node src/main.js add-to-blacklist       \u2014 Add a new pattern',
        '  \u2022 node src/main.js remove-from-blacklist  \u2014 Remove a pattern'
    );

    // --- P1 Section ---
    if (fp1.length > 0) {
        lines.push(
            '',
            '================================================================================',
            '',
            `--- [P1] Safe to Delete (No Code, No Values) --- [${fp1.length} preferences]`,
            ...fp1.map(c => c.id)
        );
    }

    // --- P2 Section ---
    if (fp2.length > 0) {
        lines.push(
            '',
            '================================================================================',
            '',
            `--- [P2] Likely Safe (No Code, Has Values) --- [${fp2.length} preferences]`
        );

        for (const c of fp2) {
            const details = [];
            if (c.hasDefault) {
                details.push('has default value');
            }
            if (c.hasValues) {
                details.push(`sites with values: ${c.siteCount}`);
            }
            lines.push(`${c.id}  |  ${details.join('  |  ')}`);
        }
    }

    // --- P3 Section ---
    if (fp3.length > 0) {
        lines.push(
            '',
            '================================================================================',
            '',
            `--- [P3] Review: Deprecated Code Only (No Values) --- [${fp3.length} preferences]`
        );

        for (const c of fp3) {
            lines.push(`${c.id}  |  deprecated: ${c.deprecatedCartridges.join(', ')}`);
        }
    }

    // --- P4 Section ---
    if (fp4.length > 0) {
        lines.push(
            '',
            '================================================================================',
            '',
            `--- [P4] Review: Deprecated Code + Values --- [${fp4.length} preferences]`
        );

        for (const c of fp4) {
            const details = [`deprecated: ${c.deprecatedCartridges.join(', ')}`];
            if (c.hasDefault) {
                details.push('has default value');
            }
            if (c.hasValues) {
                details.push(`sites with values: ${c.siteCount}`);
            }
            lines.push(`${c.id}  |  ${details.join('  |  ')}`);
        }
    }

    // --- Blacklisted Section ---
    if (blacklistedPreferences.length > 0) {
        lines.push(
            '',
            '================================================================================',
            '',
            '--- Blacklisted Preferences (Protected) ---',
            ...blacklistedPreferences.sort()
        );
    }

    fs.writeFileSync(outputFilePath, lines.join('\n'), 'utf-8');

    return outputFilePath;
}

/**
 * Find usage for all active preferences in repository (optimized batch search)
 * @param {string} repositoryPath - Absolute path to repository root
 * @param {Object} [options] - Optional settings
 * @returns {Promise<Array>} Array of results for each preference
 */
export async function findAllActivePreferencesUsage(repositoryPath, options = {}) {
    const matrixFiles = findAllMatrixFiles(options.realmFilter || null);
    const comparisonFilePath = options.comparisonFilePath || DEFAULT_COMPARISON_FILE_PATH;
    const progressCallback = options.progressCallback || null;

    const log = progressCallback ? () => {} : console.log.bind(console);

    if (matrixFiles.length === 0) {
        log('No matrix files found.');
        return [];
    }

    log(`Found ${matrixFiles.length} matrix file(s)\n`);

    const matrixFilePaths = matrixFiles.map(f => f.matrixFile);
    const activePreferences = Array.from(getActivePreferencesFromMatrices(matrixFilePaths)).sort();

    log(`Found ${activePreferences.length} active preference(s)\n`);

    // Get deprecated cartridges for tagging
    const deprecatedCartridges = getDeprecatedCartridges(comparisonFilePath);

    // Collect all file paths (synchronous - may take time for large repos)
    log('Collecting all file paths...');
    const allFiles = collectAllFilePaths(repositoryPath);
    log(`Total files to scan: ${allFiles.length}\n`);

    // Track which preferences are found in which cartridges (with deprecation status)
    const preferenceToCartridges = new Map();
    activePreferences.forEach(pref => preferenceToCartridges.set(pref, {
        active: new Set(),
        deprecated: new Set()
    }));

    const logEvery = options.logEvery || 100;
    let scannedFiles = 0;

    // Start the spinner for scanning (only when no progress callback handles display)
    if (!progressCallback) {
        logStatusUpdate('Starting file scan...');
    }

    // Signal initial progress (0 of total)
    if (progressCallback) {
        progressCallback(0, allFiles.length);
    }

    // Scan each file once, looking for all preferences
    // We yield to event loop after each file to allow smooth spinner animation and Ctrl+C
    for (const fileInfo of allFiles) {
        const foundPrefs = searchMultiplePreferencesInFile(fileInfo.path, activePreferences);

        // Record cartridges for each found preference
        foundPrefs.forEach(pref => {
            if (fileInfo.cartridge) {
                const isDeprecated = deprecatedCartridges.has(fileInfo.cartridge);
                const category = isDeprecated ? 'deprecated' : 'active';
                preferenceToCartridges.get(pref)[category].add(fileInfo.cartridge);
            }
        });

        scannedFiles += 1;

        // Update progress callback every logEvery files, or log to console if no callback
        if (scannedFiles % logEvery === 0 || scannedFiles === allFiles.length) {
            const percent = ((scannedFiles / allFiles.length) * 100).toFixed(1);
            if (progressCallback) {
                progressCallback(scannedFiles, allFiles.length);
            } else {
                logStatusUpdate(`Scanned ${scannedFiles}/${allFiles.length} files (${percent}%)`);
            }
        }

        // Yield to event loop after each file for smooth spinner animation
        await setImmediate();
    }

    logStatusClear();

    // Build results array
    const results = activePreferences.map(preferenceId => {
        const cartridgeData = preferenceToCartridges.get(preferenceId);
        const activeCartridgeList = Array.from(cartridgeData.active).sort();
        const deprecatedCartridgeList = Array.from(cartridgeData.deprecated).sort();
        const allCartridges = activeCartridgeList
            .concat(deprecatedCartridgeList.map(c => `${c} [possibly deprecated]`))
            .sort();

        return {
            preferenceId,
            repositoryPath,
            comparisonFilePath,
            deprecatedCartridgesCount: deprecatedCartridges.size,
            totalMatches: allCartridges.length,
            cartridges: allCartridges,
            activeCartridges: activeCartridgeList,
            deprecatedCartridges: deprecatedCartridgeList
        };
    });

    // Export results to file
    const instanceTypeOverride = options.instanceTypeOverride || null;

    // Export unused preferences to separate file
    const unusedFile = exportUnusedPreferencesToFile(results, instanceTypeOverride);
    if (unusedFile) {
        console.log(`✓ Unused preferences saved to: ${unusedFile}`);
    }

    // Export cartridge-to-preferences mapping
    const cartridgeFile = exportCartridgePreferenceMapping(results, instanceTypeOverride);
    if (cartridgeFile) {
        console.log(`✓ Cartridge preference mapping saved to: ${cartridgeFile}`);
    }

    // Generate deletion candidates with priority ranking
    const deletionFile = generatePreferenceDeletionCandidates(instanceTypeOverride, results);
    if (deletionFile) {
        console.log(`✓ Preferences marked for deletion: ${deletionFile}`);
    }

    console.log('');

    return results;
}

export async function findPreferenceUsage(preferenceId, repositoryPath, options = {}) {
    const comparisonFilePath = options.comparisonFilePath || DEFAULT_COMPARISON_FILE_PATH;
    const isFirstSearch = options.isFirstSearch || false;
    const deprecatedCartridges = getDeprecatedCartridges(comparisonFilePath);
    const matches = [];
    const totalFiles = countScannableFiles(repositoryPath);
    const state = {
        scannedFiles: 0,
        matchesFound: 0,
        logEvery: options.logEvery || 200,
        totalFiles
    };

    if (isFirstSearch) {
        console.log(`Searching for '${preferenceId}'...`);
        console.log(`Filtering deprecated cartridges: ${deprecatedCartridges.size}`);
        console.log(`Logging every ${state.logEvery} files scanned.`);
        console.log(`Total files to scan: ${state.totalFiles}`);
    }

    searchDirectoryForPreference(repositoryPath, preferenceId, deprecatedCartridges, matches, state, isFirstSearch);

    if (isFirstSearch) {
        console.log(
            `Scan complete. Files scanned: ${state.scannedFiles}/${state.totalFiles}. `
            + `Matches: ${state.matchesFound}.`
        );
    }

    // Extract unique cartridge names from matches
    const cartridges = Array.from(new Set(
        matches
            .map(match => getCartridgeNameFromPath(match.filePath))
            .filter(Boolean)
    )).sort();

    return {
        preferenceId,
        repositoryPath,
        comparisonFilePath,
        deprecatedCartridgesCount: deprecatedCartridges.size,
        totalMatches: matches.length,
        cartridges
    };
}
