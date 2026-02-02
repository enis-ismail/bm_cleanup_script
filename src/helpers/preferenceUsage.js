/* eslint-disable linebreak-style */
import fs from 'fs';
import path from 'path';

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

function logProgress(state) {
    if (state.scannedFiles % state.logEvery === 0 || state.scannedFiles === state.totalFiles) {
        const remaining = Math.max(state.totalFiles - state.scannedFiles, 0);
        const percent = state.totalFiles > 0
            ? Math.min((state.scannedFiles / state.totalFiles) * 100, 100)
            : 100;

        console.log(
            `Scanned ${state.scannedFiles}/${state.totalFiles} files (${percent.toFixed(1)}%), `
            + `remaining: ${remaining}, matches: ${state.matchesFound}`
        );
    }
}

function searchDirectoryForPreference(dirPath, preferenceId, deprecatedCartridges, matches, state) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (shouldSkipDirectory(entry.name)) {
                continue;
            }
            searchDirectoryForPreference(entryPath, preferenceId, deprecatedCartridges, matches, state);
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
            logProgress(state);
        } catch {
            // Ignore unreadable/binary files
        }
    }
}

/**
 * Find usage locations for a preference ID in repository cartridges
 * @param {string} preferenceId - Preference ID to search for
 * @param {string} repositoryPath - Absolute path to repository root
 * @param {Object} [options] - Optional settings
 * @param {string} [options.comparisonFilePath] - Path to cartridge comparison file
 * @returns {Object} Usage results with matches and counts
 */
export async function findPreferenceUsage(preferenceId, repositoryPath, options = {}) {
    const comparisonFilePath = options.comparisonFilePath || DEFAULT_COMPARISON_FILE;
    const deprecatedCartridges = getDeprecatedCartridges(comparisonFilePath);
    const matches = [];
    const totalFiles = countScannableFiles(repositoryPath);
    const state = {
        scannedFiles: 0,
        matchesFound: 0,
        logEvery: options.logEvery || 200,
        totalFiles
    };

    console.log(`Searching for '${preferenceId}'...`);
    console.log(`Filtering deprecated cartridges: ${deprecatedCartridges.size}`);
    console.log(`Logging every ${state.logEvery} files scanned.`);
    console.log(`Total files to scan: ${state.totalFiles}`);

    searchDirectoryForPreference(repositoryPath, preferenceId, deprecatedCartridges, matches, state);

    console.log(
        `Scan complete. Files scanned: ${state.scannedFiles}/${state.totalFiles}. `
        + `Matches: ${state.matchesFound}.`
    );

    return {
        preferenceId,
        repositoryPath,
        comparisonFilePath,
        deprecatedCartridgesCount: deprecatedCartridges.size,
        totalMatches: matches.length,
        matches
    };
}
