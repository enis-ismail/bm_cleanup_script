import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Module Mocks
// ============================================================================

vi.mock('../../src/io/csv.js', () => ({
    parseCSVToNestedArray: vi.fn(() => []),
    findUnusedPreferences: vi.fn(() => []),
    writeUnusedPreferencesFile: vi.fn(() => '/mock/unused.txt'),
    writeUsageCSV: vi.fn(() => '/mock/usage.csv'),
    writeMatrixCSV: vi.fn(() => '/mock/matrix.csv')
}));

vi.mock('../../src/io/util.js', () => ({
    ensureResultsDir: vi.fn(() => '/mock/results'),
    buildGroupSummaries: vi.fn(() => ({})),
    filterSitesByScope: vi.fn((sites) => sites)
}));

vi.mock('../../src/scripts/loggingScript/log.js', () => ({
    logProcessingRealm: vi.fn(),
    logEmptyCSV: vi.fn(),
    logRealmResults: vi.fn(),
    logError: vi.fn(),
    logStatusUpdate: vi.fn(),
    logStatusClear: vi.fn()
}));

vi.mock('../../src/api/api.js', () => ({
    getAttributeGroups: vi.fn(),
    getAllSites: vi.fn(),
    getSitePreferences: vi.fn()
}));

vi.mock('../../src/helpers/summarize.js', () => ({
    buildPreferenceMeta: vi.fn(() => ({})),
    processSitesAndGroups: vi.fn(async () => ({ usageRows: [] })),
    buildPreferenceMatrix: vi.fn(() => [])
}));

vi.mock('../../src/io/siteXmlHelper.js', () => ({
    getAllAttributeDefinitionsFromMetadata: vi.fn(),
    getAttributeGroupsFromMetadataFile: vi.fn()
}));

vi.mock('../../src/config/constants.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        LOG_PREFIX: original.LOG_PREFIX || { INFO: 'ℹ' }
    };
});

// ============================================================================
// Imports — after mocks
// ============================================================================

import { processPreferenceMatrixFiles } from '../../src/helpers/analyzer.js';
import { parseCSVToNestedArray, findUnusedPreferences, writeUnusedPreferencesFile } from '../../src/io/csv.js';
import { logProcessingRealm, logEmptyCSV, logRealmResults } from '../../src/scripts/loggingScript/log.js';

// ============================================================================
// processPreferenceMatrixFiles
// ============================================================================

describe('processPreferenceMatrixFiles', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-test-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('returns empty array for empty input', async () => {
        const result = await processPreferenceMatrixFiles([]);
        expect(result).toEqual([]);
    });

    it('processes a single matrix file and returns summary', async () => {
        const matrixPath = path.join(tmpDir, 'EU05_matrix.csv');
        fs.writeFileSync(matrixPath, 'placeholder', 'utf-8');

        // Mock CSV parsing to return matrix data
        parseCSVToNestedArray.mockReturnValue([
            ['preferenceId', 'defaultValue', 'EU'],
            ['c_prefA', '', 'X'],
            ['c_prefB', 'default', ''],
            ['c_prefC', '', '']
        ]);

        findUnusedPreferences.mockReturnValue(['c_prefC']);
        writeUnusedPreferencesFile.mockReturnValue(path.join(tmpDir, 'EU05_unused.txt'));

        const result = await processPreferenceMatrixFiles([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            realm: 'EU05',
            total: 3,
            unused: 1,
            used: 2
        });
    });

    it('processes multiple realm matrix files', async () => {
        const eu05Path = path.join(tmpDir, 'EU05_matrix.csv');
        const apacPath = path.join(tmpDir, 'APAC_matrix.csv');
        fs.writeFileSync(eu05Path, 'placeholder', 'utf-8');
        fs.writeFileSync(apacPath, 'placeholder', 'utf-8');

        let callCount = 0;
        parseCSVToNestedArray.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // EU05: 5 prefs, 2 unused
                return [
                    ['preferenceId', 'defaultValue', 'EU'],
                    ['c_a', '', 'X'],
                    ['c_b', '', 'X'],
                    ['c_c', '', ''],
                    ['c_d', '', ''],
                    ['c_e', 'val', '']
                ];
            }
            // APAC: 3 prefs, 1 unused
            return [
                ['preferenceId', 'defaultValue', 'APAC_site'],
                ['c_x', '', 'X'],
                ['c_y', '', 'X'],
                ['c_z', '', '']
            ];
        });

        let unusedCallCount = 0;
        findUnusedPreferences.mockImplementation(() => {
            unusedCallCount++;
            return unusedCallCount === 1 ? ['c_c', 'c_d'] : ['c_z'];
        });

        const result = await processPreferenceMatrixFiles([
            { realm: 'EU05', matrixFile: eu05Path },
            { realm: 'APAC', matrixFile: apacPath }
        ]);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ realm: 'EU05', total: 5, unused: 2, used: 3 });
        expect(result[1]).toEqual({ realm: 'APAC', total: 3, unused: 1, used: 2 });
    });

    it('skips realms with empty CSV data', async () => {
        const emptyPath = path.join(tmpDir, 'EMPTY_matrix.csv');
        const validPath = path.join(tmpDir, 'EU05_matrix.csv');
        fs.writeFileSync(emptyPath, '', 'utf-8');
        fs.writeFileSync(validPath, 'placeholder', 'utf-8');

        let callCount = 0;
        parseCSVToNestedArray.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return []; // Empty CSV
            }
            return [
                ['preferenceId', 'defaultValue', 'EU'],
                ['c_valid', '', 'X']
            ];
        });

        findUnusedPreferences.mockReturnValue([]);

        const result = await processPreferenceMatrixFiles([
            { realm: 'EMPTY', matrixFile: emptyPath },
            { realm: 'EU05', matrixFile: validPath }
        ]);

        expect(result).toHaveLength(1);
        expect(result[0].realm).toBe('EU05');
        expect(logEmptyCSV).toHaveBeenCalledOnce();
    });

    it('calls logProcessingRealm for each realm', async () => {
        const matrixPath = path.join(tmpDir, 'GB_matrix.csv');
        fs.writeFileSync(matrixPath, 'placeholder', 'utf-8');

        parseCSVToNestedArray.mockReturnValue([
            ['preferenceId', 'defaultValue', 'GB'],
            ['c_pref', '', 'X']
        ]);
        findUnusedPreferences.mockReturnValue([]);

        await processPreferenceMatrixFiles([
            { realm: 'GB', matrixFile: matrixPath }
        ]);

        expect(logProcessingRealm).toHaveBeenCalledWith('GB');
    });

    it('passes correct arguments to writeUnusedPreferencesFile', async () => {
        const matrixPath = path.join(tmpDir, 'PNA_matrix.csv');
        fs.writeFileSync(matrixPath, 'placeholder', 'utf-8');

        parseCSVToNestedArray.mockReturnValue([
            ['preferenceId', 'defaultValue', 'PNA_site'],
            ['c_a', '', ''],
            ['c_b', '', '']
        ]);

        const unusedList = ['c_a', 'c_b'];
        findUnusedPreferences.mockReturnValue(unusedList);

        await processPreferenceMatrixFiles([
            { realm: 'PNA', matrixFile: matrixPath }
        ]);

        expect(writeUnusedPreferencesFile).toHaveBeenCalledWith(
            path.dirname(matrixPath),
            'PNA',
            unusedList
        );
    });

    it('reports results via logRealmResults', async () => {
        const matrixPath = path.join(tmpDir, 'EU05_matrix.csv');
        fs.writeFileSync(matrixPath, 'placeholder', 'utf-8');

        parseCSVToNestedArray.mockReturnValue([
            ['preferenceId', 'defaultValue', 'EU'],
            ['c_a', '', 'X'],
            ['c_b', '', '']
        ]);

        findUnusedPreferences.mockReturnValue(['c_b']);
        writeUnusedPreferencesFile.mockReturnValue('/output/unused.txt');

        await processPreferenceMatrixFiles([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        expect(logRealmResults).toHaveBeenCalledWith(2, 1, '/output/unused.txt');
    });

    it('computes used count as total minus unused', async () => {
        const matrixPath = path.join(tmpDir, 'EU05_matrix.csv');
        fs.writeFileSync(matrixPath, 'placeholder', 'utf-8');

        // 10 prefs, 3 unused → 7 used
        const rows = [['preferenceId', 'defaultValue', 'EU']];
        for (let i = 0; i < 10; i++) {
            rows.push([`c_pref${i}`, '', i < 7 ? 'X' : '']);
        }
        parseCSVToNestedArray.mockReturnValue(rows);
        findUnusedPreferences.mockReturnValue(['c_pref7', 'c_pref8', 'c_pref9']);

        const result = await processPreferenceMatrixFiles([
            { realm: 'EU05', matrixFile: matrixPath }
        ]);

        expect(result[0].total).toBe(10);
        expect(result[0].unused).toBe(3);
        expect(result[0].used).toBe(7);
    });
});
