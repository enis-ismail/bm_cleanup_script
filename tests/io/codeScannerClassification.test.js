import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Module Mocks — declared BEFORE importing the module under test
// ============================================================================

vi.mock('../../src/io/util.js', () => ({
    ensureResultsDir: vi.fn(),
    findAllMatrixFiles: vi.fn(() => []),
    findAllUsageFiles: vi.fn(() => []),
    getResultsPath: vi.fn((realm) => `/mock/results/${realm}`),
    buildGroupSummaries: vi.fn(() => ({}))
}));

vi.mock('../../src/config/helpers/helpers.js', () => ({
    getRealmsByInstanceType: vi.fn(() => [])
}));

vi.mock('../../src/commands/setup/helpers/blacklistHelper.js', () => ({
    loadBlacklist: vi.fn(() => ({ blacklist: [] })),
    filterBlacklisted: vi.fn((ids) => ({ allowed: ids, blocked: [] }))
}));

vi.mock('../../src/helpers/backupJob.js', () => ({
    getMetadataBackupPathForRealm: vi.fn(() => '/nonexistent')
}));

vi.mock('../../src/scripts/loggingScript/log.js', () => ({
    logStatusUpdate: vi.fn(),
    logStatusClear: vi.fn(),
    logProgress: vi.fn(),
    logError: vi.fn()
}));

vi.mock('../../src/io/csv.js', () => ({
    parseCSVToNestedArray: vi.fn(() => [])
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import {
    generatePreferenceDeletionCandidates,
    getActivePreferencesFromMatrices
} from '../../src/io/codeScanner.js';
import { ensureResultsDir, findAllMatrixFiles, findAllUsageFiles, getResultsPath } from '../../src/io/util.js';
import { getRealmsByInstanceType } from '../../src/config/helpers/helpers.js';
import { loadBlacklist, filterBlacklisted } from '../../src/commands/setup/helpers/blacklistHelper.js';
import { parseCSVToNestedArray } from '../../src/io/csv.js';

// ============================================================================
// Test Helpers
// ============================================================================

let tmpDir;
let devDir; // Subdirectory with 'development' in the path for instance type filtering

/**
 * Create a file in tmpDir with LF line endings.
 * @param {string} name - Filename
 * @param {string[]} lines - Lines of content
 * @returns {string} Absolute path
 */
function writeFixture(name, lines) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    return filePath;
}

/**
 * Create a matrix CSV file inside the development/ subdirectory so that
 * buildPreferenceValueMap's instance type filter passes.
 * @param {string} name - Filename
 * @returns {string} Absolute path
 */
function createMatrixFile(name) {
    const filePath = path.join(devDir, name);
    fs.writeFileSync(filePath, 'placeholder', 'utf-8');
    return filePath;
}

/**
 * Build a minimal unused preferences file matching the production format.
 * @param {string[]} prefIds - Preference IDs to include
 * @param {Object} [opts] - Options
 * @param {string} [opts.realm='EU05'] - Realm name
 * @param {string} [opts.instanceType='development'] - Instance type
 * @returns {string[]} Lines of the file
 */
function buildUnusedPrefLines(prefIds, opts = {}) {
    const realm = opts.realm || 'EU05';
    const instanceType = opts.instanceType || 'development';
    return [
        `Unused Preferences for ${realm}`,
        `Instance: ${instanceType}`,
        `Total unused: ${prefIds.length}`,
        '',
        '--- Preference IDs ---',
        ...prefIds
    ];
}

/**
 * Build a minimal cartridge preferences file matching the production format.
 * @param {Object} cartridgeMap - { cartridgeName: [prefId, ...], ... }
 * @returns {string[]} Lines of the file
 */
function buildCartridgePrefLines(cartridgeMap) {
    const lines = [
        'Cartridge Preferences — Code Reference Analysis',
        'Generated: 2026-03-04T12:00:00.000Z',
        '',
        `Found ${Object.keys(cartridgeMap).length} preferences with cartridge references:`,
        ''
    ];
    for (const [cartridge, prefs] of Object.entries(cartridgeMap)) {
        lines.push(`${cartridge} (${prefs.length} preferences)`);
        for (const p of prefs) {
            lines.push(`\t\u2022\t${p}`);
        }
        lines.push('');
    }
    return lines;
}

// ============================================================================
// generatePreferenceDeletionCandidates — Core Classification Tests
// ============================================================================

describe('generatePreferenceDeletionCandidates', () => {

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescanner-test-'));
        devDir = path.join(tmpDir, 'development');
        fs.mkdirSync(devDir, { recursive: true });
        vi.spyOn(console, 'log').mockImplementation(() => {});

        // Default mock setup — no realm data, no blacklist
        ensureResultsDir.mockReturnValue(tmpDir);
        getRealmsByInstanceType.mockReturnValue([]);
        loadBlacklist.mockReturnValue({ blacklist: [] });
        filterBlacklisted.mockImplementation((ids) => ({ allowed: ids, blocked: [] }));
        findAllMatrixFiles.mockReturnValue([]);
        findAllUsageFiles.mockReturnValue([]);
        parseCSVToNestedArray.mockReturnValue([]);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------
    // File requirement checks
    // -------------------------------------------------------------------

    it('returns null when unused file does not exist', () => {
        // Cartridge file exists but unused does not
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        const result = generatePreferenceDeletionCandidates('development', []);
        expect(result).toBeNull();
    });

    it('returns null when cartridge file does not exist', () => {
        // Unused file exists but cartridge does not
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(['c_pref']));

        const result = generatePreferenceDeletionCandidates('development', []);
        expect(result).toBeNull();
    });

    // -------------------------------------------------------------------
    // P1: No code, no values
    // -------------------------------------------------------------------

    it('classifies preferences as P1 when no code refs and no values', () => {
        const unusedPrefs = ['c_unusedA', 'c_unusedB', 'c_unusedC'];

        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        const outputPath = generatePreferenceDeletionCandidates('development', []);

        expect(outputPath).not.toBeNull();
        const content = fs.readFileSync(outputPath, 'utf-8');

        // All 3 should be P1
        expect(content).toContain('[P1] Safe to Delete');
        expect(content).toContain('c_unusedA');
        expect(content).toContain('c_unusedB');
        expect(content).toContain('c_unusedC');
        expect(content).toMatch(/\[P1\].*3 preferences/);

        // No other tiers should appear
        expect(content).not.toMatch(/--- \[P2\]/);
        expect(content).not.toMatch(/--- \[P3\]/);
        expect(content).not.toMatch(/--- \[P4\]/);
        expect(content).not.toMatch(/--- \[P5\]/);
    });

    // -------------------------------------------------------------------
    // P2: No code, has values
    // -------------------------------------------------------------------

    it('classifies as P2 when no code refs but preference has values', () => {
        const unusedPrefs = ['c_hasValues', 'c_hasDefault'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        // Mock the matrix CSV to return value data
        const matrixPath = createMatrixFile('EU05_matrix.csv');
        findAllMatrixFiles.mockReturnValue([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        // When parseCSVToNestedArray is called for the matrix, return data with values
        parseCSVToNestedArray.mockImplementation((filePath) => {
            if (filePath === matrixPath) {
                return [
                    ['preferenceId', 'defaultValue', 'EU'],
                    ['c_hasValues', '', 'X'],       // Has site values, no default
                    ['c_hasDefault', 'true', '']    // Has default, no site values
                ];
            }
            return [];
        });

        const outputPath = generatePreferenceDeletionCandidates('development', []);

        expect(outputPath).not.toBeNull();
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toContain('[P2]');
        expect(content).toContain('c_hasValues');
        expect(content).toContain('c_hasDefault');
        expect(content).toMatch(/\[P2\].*2 preferences/);
    });

    it('distinguishes P1 from P2 in the same run', () => {
        const unusedPrefs = ['c_noValues', 'c_withValues'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        const matrixPath = createMatrixFile('EU05_matrix.csv');
        findAllMatrixFiles.mockReturnValue([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        parseCSVToNestedArray.mockImplementation((filePath) => {
            if (filePath === matrixPath) {
                return [
                    ['preferenceId', 'defaultValue', 'EU'],
                    ['c_noValues', '', ''],         // P1: no values
                    ['c_withValues', 'default', 'X'] // P2: has both
                ];
            }
            return [];
        });

        const outputPath = generatePreferenceDeletionCandidates('development', []);
        const content = fs.readFileSync(outputPath, 'utf-8');

        // P1 section should have c_noValues
        const p1Section = content.split(/--- \[P2\]/)[0];
        expect(p1Section).toContain('c_noValues');
        expect(p1Section).not.toContain('c_withValues');

        // P2 section should have c_withValues
        expect(content).toContain('[P2]');
        const afterP2 = content.split(/--- \[P2\]/)[1];
        expect(afterP2).toContain('c_withValues');
    });

    // -------------------------------------------------------------------
    // P3: Deprecated code only, no values
    // -------------------------------------------------------------------

    it('classifies as P3 when only deprecated cartridge refs exist and no values', () => {
        // The pref is not in unused (it has code refs), but all refs are deprecated
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines([]));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({
            'int_deprecated_cartridge': ['c_deprecatedPref']
        }));

        const codeResults = [{
            preferenceId: 'c_deprecatedPref',
            activeCartridges: [],
            deprecatedCartridges: ['int_deprecated_cartridge']
        }];

        const outputPath = generatePreferenceDeletionCandidates('development', codeResults);
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toContain('[P3]');
        expect(content).toContain('c_deprecatedPref');
        expect(content).toContain('deprecated: int_deprecated_cartridge');
    });

    // -------------------------------------------------------------------
    // P4: Deprecated code only, has values
    // -------------------------------------------------------------------

    it('classifies as P4 when deprecated code refs exist and has values', () => {
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines([]));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({
            'int_old_payment': ['c_deprecatedWithValues']
        }));

        const matrixPath = createMatrixFile('EU05_matrix.csv');
        findAllMatrixFiles.mockReturnValue([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        parseCSVToNestedArray.mockImplementation((filePath) => {
            if (filePath === matrixPath) {
                return [
                    ['preferenceId', 'defaultValue', 'EU', 'GB'],
                    ['c_deprecatedWithValues', 'fallback', 'X', '']
                ];
            }
            return [];
        });

        const codeResults = [{
            preferenceId: 'c_deprecatedWithValues',
            activeCartridges: [],
            deprecatedCartridges: ['int_old_payment']
        }];

        const outputPath = generatePreferenceDeletionCandidates('development', codeResults);
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toContain('[P4]');
        expect(content).toContain('c_deprecatedWithValues');
        expect(content).toContain('deprecated: int_old_payment');
        expect(content).toContain('has default value');
        expect(content).toContain('sites with values: 1');
    });

    // -------------------------------------------------------------------
    // P5: Active code only in some realms
    // -------------------------------------------------------------------

    it('classifies as P5 when active code is only in some realms', () => {
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines([]));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({
            'app_custom_eu': ['c_euOnlyPref']
        }));

        // Enable realm data
        getRealmsByInstanceType.mockReturnValue(['EU05', 'APAC', 'PNA', 'GB']);

        // Per-realm cartridge CSV files — app_custom_eu only active on EU05
        getResultsPath.mockImplementation(() => tmpDir);

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_active_site_cartridges_list.csv'),
            'siteId,cartridges\nEU_site1,app_custom_eu:app_storefront_base', 'utf-8'
        );
        fs.writeFileSync(
            path.join(tmpDir, 'APAC_active_site_cartridges_list.csv'),
            'siteId,cartridges\nAPAC_site1,app_storefront_base', 'utf-8'
        );
        fs.writeFileSync(
            path.join(tmpDir, 'PNA_active_site_cartridges_list.csv'),
            'siteId,cartridges\nPNA_site1,app_storefront_base', 'utf-8'
        );
        fs.writeFileSync(
            path.join(tmpDir, 'GB_active_site_cartridges_list.csv'),
            'siteId,cartridges\nGB_site1,app_storefront_base', 'utf-8'
        );

        const codeResults = [{
            preferenceId: 'c_euOnlyPref',
            activeCartridges: ['app_custom_eu'],
            deprecatedCartridges: []
        }];

        const outputPath = generatePreferenceDeletionCandidates('development', codeResults);
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toContain('[P5]');
        expect(content).toContain('c_euOnlyPref');
        expect(content).toContain('active in: EU05');
    });

    // -------------------------------------------------------------------
    // Mixed tiers in a single run
    // -------------------------------------------------------------------

    it('correctly classifies mixed P1, P2, P3, P4 in a single run', () => {
        // P1 and P2 candidates: in unused, not in cartridge code
        const unusedPrefs = ['c_pureUnused', 'c_unusedWithVal'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({
            'int_legacy': ['c_deprecOnly', 'c_deprecWithVal']
        }));

        const matrixPath = createMatrixFile('EU05_matrix.csv');
        findAllMatrixFiles.mockReturnValue([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        parseCSVToNestedArray.mockImplementation((filePath) => {
            if (filePath === matrixPath) {
                return [
                    ['preferenceId', 'defaultValue', 'EU'],
                    ['c_pureUnused', '', ''],           // P1
                    ['c_unusedWithVal', '', 'X'],       // P2
                    ['c_deprecOnly', '', ''],           // P3
                    ['c_deprecWithVal', 'yes', 'X']     // P4
                ];
            }
            return [];
        });

        const codeResults = [
            { preferenceId: 'c_deprecOnly', activeCartridges: [], deprecatedCartridges: ['int_legacy'] },
            { preferenceId: 'c_deprecWithVal', activeCartridges: [], deprecatedCartridges: ['int_legacy'] }
        ];

        const outputPath = generatePreferenceDeletionCandidates('development', codeResults);
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toMatch(/\[P1\].*1 preferences/);
        expect(content).toMatch(/\[P2\].*1 preferences/);
        expect(content).toMatch(/\[P3\].*1 preferences/);
        expect(content).toMatch(/\[P4\].*1 preferences/);

        // Summary counts
        expect(content).toContain('Total deletion candidates: 4');
    });

    // -------------------------------------------------------------------
    // Blacklist filtering
    // -------------------------------------------------------------------

    it('excludes blacklisted preferences from all tiers', () => {
        const unusedPrefs = ['c_keepMe', 'c_blockMe', 'c_alsoKeep'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        filterBlacklisted.mockImplementation((ids) => ({
            allowed: ids.filter(id => id !== 'c_blockMe'),
            blocked: ids.filter(id => id === 'c_blockMe')
        }));

        const outputPath = generatePreferenceDeletionCandidates('development', []);
        const content = fs.readFileSync(outputPath, 'utf-8');

        // Verify the file contains P1 section with the non-blocked prefs
        expect(content).toContain('c_keepMe');
        expect(content).toContain('c_alsoKeep');

        // c_blockMe should appear in blacklisted section, not in P1
        expect(content).toContain('Blacklisted Preferences (Protected)');
        expect(content).toContain('c_blockMe');

        // P1 count should be 2 (3 - 1 blacklisted)
        expect(content).toMatch(/\[P1\].*2 preferences/);
        expect(content).toContain('Blacklisted (protected): 1');
    });

    // -------------------------------------------------------------------
    // Preference NOT in unused AND has active code → not a candidate
    // -------------------------------------------------------------------

    it('does not include preferences with active code references', () => {
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(['c_unused']));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({
            'app_custom_brand': ['c_activeInCode']
        }));

        const codeResults = [{
            preferenceId: 'c_activeInCode',
            activeCartridges: ['app_custom_brand'],
            deprecatedCartridges: []
        }];

        const outputPath = generatePreferenceDeletionCandidates('development', codeResults);
        const content = fs.readFileSync(outputPath, 'utf-8');

        // c_activeInCode should NOT appear (it has active code refs + is in ALL realms)
        expect(content).not.toContain('c_activeInCode');
        // c_unused is P1
        expect(content).toContain('c_unused');
    });

    // -------------------------------------------------------------------
    // Value map merges across multiple realm matrix files
    // -------------------------------------------------------------------

    it('merges values across multiple realm matrix files', () => {
        const unusedPrefs = ['c_multiRealm'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        const eu05Matrix = createMatrixFile('EU05_matrix.csv');
        const apacMatrix = createMatrixFile('APAC_matrix.csv');

        findAllMatrixFiles.mockReturnValue([
            { realm: 'EU05', matrixFile: eu05Matrix },
            { realm: 'APAC', matrixFile: apacMatrix }
        ]);

        parseCSVToNestedArray.mockImplementation((filePath) => {
            if (filePath === eu05Matrix) {
                return [
                    ['preferenceId', 'defaultValue', 'EU'],
                    ['c_multiRealm', '', '']   // No values on EU05
                ];
            }
            if (filePath === apacMatrix) {
                return [
                    ['preferenceId', 'defaultValue', 'APAC_site'],
                    ['c_multiRealm', '', 'X']  // Has value on APAC
                ];
            }
            return [];
        });

        const outputPath = generatePreferenceDeletionCandidates('development', []);
        const content = fs.readFileSync(outputPath, 'utf-8');

        // Should be P2 because APAC has a value (merged)
        expect(content).toContain('[P2]');
        expect(content).toContain('c_multiRealm');
    });

    // -------------------------------------------------------------------
    // Output format: summary section
    // -------------------------------------------------------------------

    it('writes correct summary header with counts', () => {
        const unusedPrefs = ['c_a', 'c_b'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        const outputPath = generatePreferenceDeletionCandidates('development', []);
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toContain('Site Preferences');
        expect(content).toContain('Deletion Candidates');
        expect(content).toContain('Instance Type: development');
        expect(content).toContain('Analysis Summary:');
        expect(content).toContain('[P1] Safe to delete (no code, no values): 2');
        expect(content).toContain('Total deletion candidates: 2');
    });

    // -------------------------------------------------------------------
    // Alphabetical sorting within tiers
    // -------------------------------------------------------------------

    it('sorts preferences alphabetically within each tier', () => {
        const unusedPrefs = ['c_zulu', 'c_alpha', 'c_mike'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        const outputPath = generatePreferenceDeletionCandidates('development', []);
        const content = fs.readFileSync(outputPath, 'utf-8');

        const alphaIdx = content.indexOf('c_alpha');
        const mikeIdx = content.indexOf('c_mike');
        const zuluIdx = content.indexOf('c_zulu');

        expect(alphaIdx).toBeLessThan(mikeIdx);
        expect(mikeIdx).toBeLessThan(zuluIdx);
    });

    // -------------------------------------------------------------------
    // P2 detail metadata in output lines
    // -------------------------------------------------------------------

    it('includes value metadata in P2 output lines', () => {
        const unusedPrefs = ['c_withDetails'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        const matrixPath = createMatrixFile('matrix.csv');
        findAllMatrixFiles.mockReturnValue([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        parseCSVToNestedArray.mockImplementation((filePath) => {
            if (filePath === matrixPath) {
                return [
                    ['preferenceId', 'defaultValue', 'site1', 'site2', 'site3'],
                    ['c_withDetails', 'defaultVal', 'X', 'X', '']
                ];
            }
            return [];
        });

        const outputPath = generatePreferenceDeletionCandidates('development', []);
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toContain('c_withDetails');
        expect(content).toContain('has default value');
        expect(content).toContain('sites with values: 2');
    });

    // -------------------------------------------------------------------
    // Empty candidates — returns null
    // -------------------------------------------------------------------

    it('returns null when all unused prefs also appear in cartridge code', () => {
        // Every preference in the unused file is also found in cartridge code
        // so they cancel out (unused but used in cartridge → not really unused)
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(['c_usedElsewhere']));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({
            'app_core': ['c_usedElsewhere']
        }));

        // c_usedElsewhere is in both unused AND used sets → skipped by the
        // "if (usedPreferences.has(prefId)) continue;" check in P1/P2 loop.
        // It has active code, so it's not P3/P4/P5 either.
        const codeResults = [{
            preferenceId: 'c_usedElsewhere',
            activeCartridges: ['app_core'],
            deprecatedCartridges: []
        }];

        const outputPath = generatePreferenceDeletionCandidates('development', codeResults);
        // Should be null — no candidates
        expect(outputPath).toBeNull();
    });

    // -------------------------------------------------------------------
    // Preference in unused AND in cartridge code → not P1/P2
    // -------------------------------------------------------------------

    it('skips preference from P1/P2 if it appears in cartridge code too', () => {
        writeFixture('development_unused_preferences.txt',
            buildUnusedPrefLines(['c_inBoth', 'c_reallyUnused']));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({
            'app_core': ['c_inBoth']
        }));

        const outputPath = generatePreferenceDeletionCandidates('development', []);
        const content = fs.readFileSync(outputPath, 'utf-8');

        // c_inBoth should be excluded from P1 (it's in usedPreferences set)
        const p1Section = content.split('Blacklisted')[0];
        expect(p1Section).not.toContain('c_inBoth');
        expect(p1Section).toContain('c_reallyUnused');
    });

    // -------------------------------------------------------------------
    // Multiple deprecated cartridges for one preference
    // -------------------------------------------------------------------

    it('lists multiple deprecated cartridges for P3/P4', () => {
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines([]));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({
            'int_old_a': ['c_multiDeprec'],
            'int_old_b': ['c_multiDeprec']
        }));

        const codeResults = [{
            preferenceId: 'c_multiDeprec',
            activeCartridges: [],
            deprecatedCartridges: ['int_old_a', 'int_old_b']
        }];

        const outputPath = generatePreferenceDeletionCandidates('development', codeResults);
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toContain('deprecated: int_old_a, int_old_b');
    });

    // -------------------------------------------------------------------
    // Site count calculation from matrix columns
    // -------------------------------------------------------------------

    it('counts lowercase x as site values', () => {
        const unusedPrefs = ['c_lcaseX'];
        writeFixture('development_unused_preferences.txt', buildUnusedPrefLines(unusedPrefs));
        writeFixture('development_cartridge_preferences.txt', buildCartridgePrefLines({}));

        const matrixPath = createMatrixFile('matrix.csv');
        findAllMatrixFiles.mockReturnValue([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        parseCSVToNestedArray.mockImplementation((filePath) => {
            if (filePath === matrixPath) {
                return [
                    ['preferenceId', 'defaultValue', 's1', 's2', 's3'],
                    ['c_lcaseX', '', 'x', 'X', 'x']
                ];
            }
            return [];
        });

        const outputPath = generatePreferenceDeletionCandidates('development', []);
        const content = fs.readFileSync(outputPath, 'utf-8');

        expect(content).toContain('sites with values: 3');
    });
});

// ============================================================================
// getActivePreferencesFromMatrices — extended tests
// ============================================================================

describe('getActivePreferencesFromMatrices – extended', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrices-ext-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('ignores blank rows in the middle of the CSV', () => {
        const csvContent = [
            'preferenceId,defaultValue,site1',
            'c_first,,X',
            '',
            'c_second,,X'
        ].join('\n');

        const filePath = path.join(tmpDir, 'matrix.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = getActivePreferencesFromMatrices([filePath]);
        // Should have 2 prefs (blank row has no preferenceId column)
        expect(result.has('c_first')).toBe(true);
        expect(result.has('c_second')).toBe(true);
    });

    it('handles CRLF line endings in CSV', () => {
        const csvContent = 'preferenceId,defaultValue,site1\r\nc_crlfPref,,X\r\n';
        const filePath = path.join(tmpDir, 'crlf.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = getActivePreferencesFromMatrices([filePath]);
        expect(result.has('c_crlfPref')).toBe(true);
    });

    it('deduplicates preferences across multiple files', () => {
        const csv1 = 'preferenceId,defaultValue\nc_shared,,\nc_onlyInA,,';
        const csv2 = 'preferenceId,defaultValue\nc_shared,,\nc_onlyInB,,';

        const f1 = path.join(tmpDir, 'a.csv');
        const f2 = path.join(tmpDir, 'b.csv');
        fs.writeFileSync(f1, csv1, 'utf-8');
        fs.writeFileSync(f2, csv2, 'utf-8');

        const result = getActivePreferencesFromMatrices([f1, f2]);
        expect(result.size).toBe(3);
    });
});
