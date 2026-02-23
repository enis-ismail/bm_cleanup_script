
import fs from 'fs';
import path from 'path';
import { setImmediate } from 'timers/promises';
import { findAllMatrixFiles } from './util.js';
import { ensureResultsDir } from './util.js';
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
 * Compare unused and cartridge preferences files and generate deletion candidates
 * @param {string} [instanceTypeOverride] - Optional instance type for output path scoping
 * @returns {string|null} Path to the generated file, or null if no candidates found
 */
export function generatePreferenceDeletionCandidates(instanceTypeOverride = null) {
    const dirName = instanceTypeOverride || IDENTIFIERS.ALL_REALMS;
    const resultsDir = ensureResultsDir(IDENTIFIERS.ALL_REALMS, instanceTypeOverride);

    const unusedFilePath = path.join(resultsDir, `${dirName}${FILE_PATTERNS.UNUSED_PREFERENCES}`);
    const cartridgeFilePath = path.join(resultsDir, `${dirName}${FILE_PATTERNS.CARTRIDGE_PREFERENCES}`);

    // Check if both files exist
    if (!fs.existsSync(unusedFilePath)) {
        console.log(`⚠ Unused preferences file not found: ${unusedFilePath}`);
        return null;
    }

    if (!fs.existsSync(cartridgeFilePath)) {
        console.log(`⚠ Cartridge preferences file not found: ${cartridgeFilePath}`);
        return null;
    }

    // Parse both files
    const unusedPreferences = parseUnusedPreferencesFile(unusedFilePath);
    const usedPreferences = parseCartridgePreferencesFile(cartridgeFilePath);

    // Find preferences that are in unused but NOT in used (truly safe to delete)
    const rawCandidates = Array.from(unusedPreferences)
        .filter(pref => !usedPreferences.has(pref))
        .sort();

    // Apply blacklist filter
    const blacklistEntries = loadBlacklist().blacklist;
    const { allowed: deletionCandidates, blocked: blacklistedPreferences } =
        filterBlacklisted(rawCandidates, blacklistEntries);

    if (blacklistedPreferences.length > 0) {
        console.log(
            `✓ Blacklist protected ${blacklistedPreferences.length} preference(s) from deletion`
        );
    }

    if (deletionCandidates.length === 0) {
        console.log('✓ No preferences marked for deletion (all unused preferences have some usage)');
        return null;
    }

    // Generate output file
    const outputFilename = `${dirName}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`;
    const outputFilePath = path.join(resultsDir, outputFilename);

    const summaryLines = [
        `  • Total unused preferences: ${unusedPreferences.size}`,
        `  • Total used preferences: ${usedPreferences.size}`,
        `  • Preferences marked for deletion: ${deletionCandidates.length}`
    ];

    if (blacklistedPreferences.length > 0) {
        summaryLines.push(
            `  • Blacklisted (protected): ${blacklistedPreferences.length}`
        );
    }

    const lines = [
        'Site Preferences Marked for Deletion',
        `Generated: ${new Date().toISOString()}`,
        '',
        'Analysis Summary:',
        ...summaryLines,
        '',
        'These preferences are:',
        '  1. Not referenced in any cartridge code',
        '  2. Not listed in the cartridge preferences mapping',
        '  3. Not on the preference blacklist',
        '  4. Safe to delete from site preferences',
        '',
        'NOTE: Preferences matching patterns in preference_blacklist.json are excluded',
        'from this list and will never be deleted. To manage the blacklist, run:',
        '  • node src/main.js list-blacklist        — View all protected patterns',
        '  • node src/main.js add-to-blacklist       — Add a new pattern',
        '  • node src/main.js remove-from-blacklist  — Remove a pattern',
        '',
        '================================================================================',
        '',
        '--- Preferences for Deletion ---',
        ...deletionCandidates
    ];

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
        const allCartridges = Array.from(cartridgeData.active)
            .concat(Array.from(cartridgeData.deprecated).map(c => `${c} [possibly deprecated]`))
            .sort();

        return {
            preferenceId,
            repositoryPath,
            comparisonFilePath,
            deprecatedCartridgesCount: deprecatedCartridges.size,
            totalMatches: allCartridges.length,
            cartridges: allCartridges
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

    // Generate deletion candidates by comparing unused vs used preferences
    const deletionFile = generatePreferenceDeletionCandidates(instanceTypeOverride);
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
