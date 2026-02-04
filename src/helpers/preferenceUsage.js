/* eslint-disable linebreak-style */
import fs from 'fs';
import path from 'path';
import { setImmediate } from 'timers/promises';
import { findAllMatrixFiles } from '../helpers.js';
import { ensureResultsDir } from './util.js';
import { logStatusUpdate, logStatusClear, logProgress } from './log.js';

const DEFAULT_COMPARISON_FILE = path.join(
    process.cwd(),
    'results',
    'ALL_REALMS',
    'ALL_REALMS_cartridge_comparison.txt'
);

const ALLOWED_EXTENSIONS = new Set([
    '.js',
    '.isml',
    '.ds',
    '.json',
    '.xml',
    '.properties',
    '.txt',
    '.html'
]);

const SKIP_DIRECTORIES = new Set([
    'node_modules',
    'sites',
    'results',
    '.git',
    '.vscode'
]);

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
 * Export preference usage results to a text file
 * @param {Array} results - Array of preference usage results
 * @param {string} [instanceTypeOverride] - Optional instance type for output path scoping
 * @returns {string} Path to the exported file
 */
function exportPreferenceUsageToFile(results, instanceTypeOverride = null) {
    const resultsDir = ensureResultsDir('ALL_REALMS', instanceTypeOverride);
    const filename = 'ALL_REALMS_preference_usage.txt';
    const filePath = path.join(resultsDir, filename);

    const lines = [
        'Preference Usage Analysis',
        `Generated: ${new Date().toISOString()}`,
        `Total Preferences Analyzed: ${results.length}`,
        '',
        '================================================================================',
        ''
    ];

    for (const result of results) {
        lines.push(`Preference: ${result.preferenceId}`);
        lines.push(`  Cartridges Found: ${result.cartridges.length}`);

        if (result.cartridges.length === 0) {
            lines.push('  (not used in any cartridge)');
        } else {
            result.cartridges.forEach(cartridge => {
                lines.push(`    • ${cartridge}`);
            });
        }

        lines.push('');
    }

    lines.push('================================================================================');
    lines.push(`Total preferences scanned: ${results.length}`);
    lines.push(`Preferences with usage: ${results.filter(r => r.cartridges.length > 0).length}`);
    lines.push(`Preferences without usage: ${results.filter(r => r.cartridges.length === 0).length}`);

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

    return filePath;
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

    const resultsDir = ensureResultsDir('ALL_REALMS', instanceTypeOverride);
    const filename = 'ALL_REALMS_unused_preferences.txt';
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
 * Find usage for all active preferences in repository (optimized batch search)
 * @param {string} repositoryPath - Absolute path to repository root
 * @param {Object} [options] - Optional settings
 * @returns {Promise<Array>} Array of results for each preference
 */
export async function findAllActivePreferencesUsage(repositoryPath, options = {}) {
    const matrixFiles = findAllMatrixFiles();
    const comparisonFilePath = options.comparisonFilePath || DEFAULT_COMPARISON_FILE;

    if (matrixFiles.length === 0) {
        console.log('No matrix files found.');
        return [];
    }

    console.log(`Found ${matrixFiles.length} matrix file(s)\n`);

    const matrixFilePaths = matrixFiles.map(f => f.matrixFile);
    const activePreferences = Array.from(getActivePreferencesFromMatrices(matrixFilePaths)).sort();

    console.log(`Found ${activePreferences.length} active preference(s)\n`);

    // Get deprecated cartridges for tagging
    const deprecatedCartridges = getDeprecatedCartridges(comparisonFilePath);

    // Collect all file paths (synchronous - may take time for large repos)
    console.log('Collecting all file paths...');
    const allFiles = collectAllFilePaths(repositoryPath);
    console.log(`Total files to scan: ${allFiles.length}\n`);

    // Track which preferences are found in which cartridges (with deprecation status)
    const preferenceToCartridges = new Map();
    activePreferences.forEach(pref => preferenceToCartridges.set(pref, {
        active: new Set(),
        deprecated: new Set()
    }));

    const logEvery = options.logEvery || 100;
    let scannedFiles = 0;

    // Start the spinner for scanning
    logStatusUpdate('Starting file scan...');

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

        // Update spinner text every logEvery files
        if (scannedFiles % logEvery === 0 || scannedFiles === allFiles.length) {
            const percent = ((scannedFiles / allFiles.length) * 100).toFixed(1);
            logStatusUpdate(`Scanned ${scannedFiles}/${allFiles.length} files (${percent}%)`);
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
    const outputFile = exportPreferenceUsageToFile(results, instanceTypeOverride);
    console.log(`✓ Preference usage results saved to: ${outputFile}`);

    // Export unused preferences to separate file
    const unusedFile = exportUnusedPreferencesToFile(results, instanceTypeOverride);
    if (unusedFile) {
        console.log(`✓ Unused preferences saved to: ${unusedFile}`);
    }

    console.log('');

    return results;
}

export async function findPreferenceUsage(preferenceId, repositoryPath, options = {}) {
    const comparisonFilePath = options.comparisonFilePath || DEFAULT_COMPARISON_FILE;
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
