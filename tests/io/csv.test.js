import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../../src/api/api.js', () => ({
    getAllSites: vi.fn(),
    getSiteById: vi.fn()
}));

vi.mock('../../src/io/util.js', () => ({
    ensureResultsDir: vi.fn()
}));

vi.mock('../../src/scripts/loggingScript/log.js', () => ({
    logError: vi.fn()
}));

vi.mock('../../src/config/helpers/helpers.js', () => ({
    deriveRealm: vi.fn()
}));

import {
    compactValue,
    findUnusedPreferences,
    writeMatrixCSV,
    writeUsageCSV,
    writeUnusedPreferencesFile,
    parseCSVToNestedArray,
    exportSitesCartridgesToCSV,
    exportAttributesToCSV
} from '../../src/io/csv.js';
import { getAllSites, getSiteById } from '../../src/api/api.js';
import { ensureResultsDir } from '../../src/io/util.js';
import { deriveRealm } from '../../src/config/helpers/helpers.js';

beforeEach(() => {
    vi.clearAllMocks();
});

// ============================================================================
// compactValue
// ============================================================================

describe('compactValue', () => {
    it('returns empty string for null and undefined', () => {
        expect(compactValue(null)).toBe('');
        expect(compactValue(undefined)).toBe('');
    });

    it('converts numbers and booleans to string', () => {
        expect(compactValue(42)).toBe('42');
        expect(compactValue(true)).toBe('true');
    });

    it('returns short strings as-is', () => {
        expect(compactValue('hello')).toBe('hello');
    });

    it('truncates long strings at 200 chars', () => {
        const longStr = 'x'.repeat(300);
        const result = compactValue(longStr);
        expect(result).toHaveLength(201); // 200 + ellipsis
        expect(result.endsWith('…')).toBe(true);
    });

    it('truncates long JSON objects at 200 chars', () => {
        const bigObj = { data: 'y'.repeat(300) };
        const result = compactValue(bigObj);
        expect(result.length).toBeLessThanOrEqual(201);
        expect(result.endsWith('…')).toBe(true);
    });

    it('returns short objects as JSON', () => {
        const obj = { key: 'val' };
        expect(compactValue(obj)).toBe('{"key":"val"}');
    });
});

// ============================================================================
// findUnusedPreferences
// ============================================================================

describe('findUnusedPreferences', () => {
    it('returns preferences with no site values and no default', () => {
        const csvData = [
            ['preferenceId', 'defaultValue', 'site1', 'site2'],
            ['usedPref', '', 'X', ''],
            ['unusedPref', '', '', ''],
            ['defaultPref', 'someDefault', '', '']
        ];

        const unused = findUnusedPreferences(csvData);
        expect(unused).toEqual(['unusedPref']);
    });

    it('keeps preferences that have a default value', () => {
        const csvData = [
            ['preferenceId', 'defaultValue', 'site1'],
            ['withDefault', 'true', '']
        ];

        const unused = findUnusedPreferences(csvData);
        expect(unused).not.toContain('withDefault');
    });

    it('keeps preferences that have at least one site "X"', () => {
        const csvData = [
            ['preferenceId', 'defaultValue', 'site1', 'site2', 'site3'],
            ['partiallyUsed', '', '', 'X', '']
        ];

        const unused = findUnusedPreferences(csvData);
        expect(unused).not.toContain('partiallyUsed');
    });

    it('returns empty array for empty/header-only CSV data', () => {
        expect(findUnusedPreferences([])).toEqual([]);
        expect(findUnusedPreferences([['preferenceId', 'defaultValue']])).toEqual([]);
    });

    it('identifies multiple unused preferences', () => {
        const csvData = [
            ['preferenceId', 'defaultValue', 'site1'],
            ['unused1', '', ''],
            ['unused2', '', ''],
            ['used1', '', 'X']
        ];

        const unused = findUnusedPreferences(csvData);
        expect(unused).toEqual(['unused1', 'unused2']);
    });
});

// ============================================================================
// writeMatrixCSV (file output)
// ============================================================================

describe('writeMatrixCSV', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('generates correct CSV structure with header and X markers', () => {
        const matrix = [
            { preferenceId: 'prefA', defaultValue: 'yes', sites: { site1: true, site2: false } },
            { preferenceId: 'prefB', defaultValue: '', sites: { site1: false, site2: true } }
        ];
        const allSiteIds = ['site1', 'site2'];

        // Suppress console.log from writeCSVFile
        vi.spyOn(console, 'log').mockImplementation(() => {});

        writeMatrixCSV(tmpDir, 'EU05', 'development', matrix, allSiteIds);

        const filePath = path.join(tmpDir, 'EU05_development_preferences_matrix.csv');
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Header
        expect(lines[0]).toBe('preferenceId,defaultValue,site1,site2');

        // Row 1: prefA has default (X), site1 used (X), site2 not used ("")
        expect(lines[1]).toContain('prefA');
        expect(lines[1]).toContain('X');

        // Row 2: prefB no default, site2 used
        expect(lines[2]).toContain('prefB');

        console.log.mockRestore();
    });
});

// ============================================================================
// writeUsageCSV (file output)
// ============================================================================

describe('writeUsageCSV', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('generates correct CSV with dynamic site columns', () => {
        const usageRows = [
            {
                siteId: 'site1', groupId: 'grp1', preferenceId: 'prefA',
                hasValue: true, value: 'val1', defaultValue: 'def1', description: 'desc1'
            },
            {
                siteId: 'site2', groupId: 'grp1', preferenceId: 'prefA',
                hasValue: true, value: 'val2', defaultValue: 'def1', description: 'desc1'
            }
        ];
        const preferenceMeta = {
            prefA: { type: 'string', defaultValue: 'def1', description: 'desc1' }
        };

        vi.spyOn(console, 'log').mockImplementation(() => {});

        writeUsageCSV(tmpDir, 'EU05', 'development', usageRows, preferenceMeta);

        const filePath = path.join(tmpDir, 'EU05_development_preferences_usage.csv');
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Header should include dynamic site columns
        expect(lines[0]).toContain('groupId');
        expect(lines[0]).toContain('preferenceId');
        expect(lines[0]).toContain('value_site1');
        expect(lines[0]).toContain('value_site2');

        // Data row should have values for both sites
        expect(lines[1]).toContain('prefA');
        expect(lines[1]).toContain('val1');
        expect(lines[1]).toContain('val2');

        console.log.mockRestore();
    });
});

// ============================================================================
// writeUnusedPreferencesFile (file output)
// ============================================================================

describe('writeUnusedPreferencesFile', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes correct header and preference list', () => {
        const unused = ['prefX', 'prefY', 'prefZ'];

        writeUnusedPreferencesFile(tmpDir, 'EU05', unused);

        const filePath = path.join(tmpDir, 'EU05_unused_preferences.txt');
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Unused Preferences for Realm: EU05');
        expect(content).toContain('Total Unused: 3');
        expect(content).toContain('--- Preference IDs ---');
        expect(content).toContain('prefX');
        expect(content).toContain('prefY');
        expect(content).toContain('prefZ');
    });

    it('handles empty preference list', () => {
        writeUnusedPreferencesFile(tmpDir, 'EU05', []);

        const filePath = path.join(tmpDir, 'EU05_unused_preferences.txt');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Total Unused: 0');
    });
});

// ============================================================================
// parseCSVToNestedArray (round-trip)
// ============================================================================

describe('parseCSVToNestedArray', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('parses simple CSV correctly', () => {
        const csvContent = 'col1,col2,col3\na,b,c\nd,e,f';
        const filePath = path.join(tmpDir, 'test.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = parseCSVToNestedArray(filePath);
        expect(result).toEqual([
            ['col1', 'col2', 'col3'],
            ['a', 'b', 'c'],
            ['d', 'e', 'f']
        ]);
    });

    it('handles quoted fields with commas', () => {
        const csvContent = 'id,value\n"pref1","has,comma"';
        const filePath = path.join(tmpDir, 'test.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = parseCSVToNestedArray(filePath);
        expect(result[1][1]).toBe('has,comma');
    });

    it('returns empty array for non-existent file', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = parseCSVToNestedArray('/nonexistent/path.csv');
        expect(result).toEqual([]);
        console.error.mockRestore();
    });

    it('handles escaped quotes within quoted fields', () => {
        const csvContent = 'id,value\n"pref1","has ""escaped"" quotes"';
        const filePath = path.join(tmpDir, 'test.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = parseCSVToNestedArray(filePath);
        expect(result[1][1]).toBe('has "escaped" quotes');
    });

    it('handles CRLF line endings', () => {
        const csvContent = 'col1,col2\r\na,b\r\nc,d';
        const filePath = path.join(tmpDir, 'test.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = parseCSVToNestedArray(filePath);
        expect(result).toHaveLength(3);
        expect(result[1]).toEqual(['a', 'b']);
        expect(result[2]).toEqual(['c', 'd']);
    });

    it('filters out blank rows', () => {
        const csvContent = 'col1,col2\na,b\n\nc,d\n';
        const filePath = path.join(tmpDir, 'test.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = parseCSVToNestedArray(filePath);
        expect(result).toHaveLength(3);
    });

    it('handles single-column CSV', () => {
        const csvContent = 'header\nrow1\nrow2';
        const filePath = path.join(tmpDir, 'test.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = parseCSVToNestedArray(filePath);
        expect(result).toEqual([['header'], ['row1'], ['row2']]);
    });
});

// ============================================================================
// exportSitesCartridgesToCSV
// ============================================================================

describe('exportSitesCartridgesToCSV', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-export-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log.mockRestore();
        vi.restoreAllMocks();
    });

    it('writes sites and cartridge paths to CSV', async () => {
        getAllSites.mockResolvedValue([
            { id: 'SiteA' },
            { id: 'SiteB' }
        ]);
        getSiteById.mockImplementation(async (siteId) => ({
            id: siteId,
            cartridges: `int_${siteId}:app_storefront_base`
        }));
        ensureResultsDir.mockReturnValue(tmpDir);

        await exportSitesCartridgesToCSV('EU05');

        expect(getAllSites).toHaveBeenCalledWith('EU05');
        expect(getSiteById).toHaveBeenCalledTimes(2);

        // Find the written file
        const files = fs.readdirSync(tmpDir);
        const csvFile = files.find(f => f.endsWith('.csv'));
        expect(csvFile).toBeTruthy();

        const content = fs.readFileSync(path.join(tmpDir, csvFile), 'utf-8');
        expect(content).toContain('id,cartridges');
        expect(content).toContain('SiteA');
        expect(content).toContain('SiteB');
    });

    it('handles no sites returned', async () => {
        getAllSites.mockResolvedValue([]);

        await exportSitesCartridgesToCSV('EU05');

        expect(getSiteById).not.toHaveBeenCalled();
    });

    it('handles sites with site_id property', async () => {
        getAllSites.mockResolvedValue([{ site_id: 'SiteC' }]);
        getSiteById.mockResolvedValue({
            site_id: 'SiteC',
            cartridges_path: 'int_siteC:app_base'
        });
        ensureResultsDir.mockReturnValue(tmpDir);

        await exportSitesCartridgesToCSV('PNA');

        const files = fs.readdirSync(tmpDir);
        const csvFile = files.find(f => f.endsWith('.csv'));
        const content = fs.readFileSync(path.join(tmpDir, csvFile), 'utf-8');
        expect(content).toContain('SiteC');
    });

    it('filters out null site details', async () => {
        getAllSites.mockResolvedValue([{ id: 'SiteA' }, { id: 'SiteB' }]);
        getSiteById.mockImplementation(async (siteId) => {
            if (siteId === 'SiteA') return { id: 'SiteA', cartridges: 'path_a' };
            return null; // SiteB returns null
        });
        ensureResultsDir.mockReturnValue(tmpDir);

        await exportSitesCartridgesToCSV('EU05');

        const files = fs.readdirSync(tmpDir);
        const csvFile = files.find(f => f.endsWith('.csv'));
        const content = fs.readFileSync(path.join(tmpDir, csvFile), 'utf-8');
        const lines = content.split('\n');
        // Header + 1 data row (SiteB filtered out)
        expect(lines).toHaveLength(2);
        expect(content).toContain('SiteA');
        expect(content).not.toContain('SiteB');
    });

    it('replaces commas with semicolons in cartridge paths', async () => {
        getAllSites.mockResolvedValue([{ id: 'SiteA' }]);
        getSiteById.mockResolvedValue({
            id: 'SiteA',
            cartridges: 'cart1,cart2,cart3'
        });
        ensureResultsDir.mockReturnValue(tmpDir);

        await exportSitesCartridgesToCSV('EU05');

        const files = fs.readdirSync(tmpDir);
        const csvFile = files.find(f => f.endsWith('.csv'));
        const content = fs.readFileSync(path.join(tmpDir, csvFile), 'utf-8');
        // Commas in the cartridge value should be replaced with semicolons
        expect(content).toContain('cart1;cart2;cart3');
    });
});

// ============================================================================
// exportAttributesToCSV
// ============================================================================

describe('exportAttributesToCSV', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-attr-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log.mockRestore();
        vi.restoreAllMocks();
    });

    it('returns empty array immediately for empty attributes', async () => {
        const result = await exportAttributesToCSV([], 'host.example.com');
        expect(result).toEqual([]);
        expect(deriveRealm).not.toHaveBeenCalled();
    });

    it('writes attributes to CSV and returns them', async () => {
        const attrs = [
            { id: 'prefA', type: 'string', default_value: 'hello', display_name: 'Pref A' },
            { id: 'prefB', type: 'boolean', default_value: true, display_name: 'Pref B' }
        ];

        deriveRealm.mockReturnValue('EU05');
        ensureResultsDir.mockReturnValue(tmpDir);

        const result = await exportAttributesToCSV(attrs, 'eu05-001.dx.commercecloud.salesforce.com');

        expect(result).toEqual(attrs);
        expect(deriveRealm).toHaveBeenCalledWith('eu05-001.dx.commercecloud.salesforce.com');

        const files = fs.readdirSync(tmpDir);
        const csvFile = files.find(f => f.endsWith('.csv'));
        expect(csvFile).toBeTruthy();

        const content = fs.readFileSync(path.join(tmpDir, csvFile), 'utf-8');
        // Header should contain the column names
        const headerLine = content.split('\n')[0];
        expect(headerLine).toContain('id');
        expect(headerLine).toContain('default_value');
    });

    it('places id column first in output', async () => {
        const attrs = [
            { display_name: 'Test', id: 'prefA', type: 'string' }
        ];

        deriveRealm.mockReturnValue('EU05');
        ensureResultsDir.mockReturnValue(tmpDir);

        await exportAttributesToCSV(attrs, 'host.test');

        const files = fs.readdirSync(tmpDir);
        const csvFile = files.find(f => f.endsWith('.csv'));
        const content = fs.readFileSync(path.join(tmpDir, csvFile), 'utf-8');
        const headerLine = content.split('\n')[0];
        expect(headerLine.startsWith('id')).toBe(true);
    });

    it('handles attributes with default property fallback', async () => {
        const attrs = [
            { id: 'prefA', default: 'fallback_val' }
        ];

        deriveRealm.mockReturnValue('GB');
        ensureResultsDir.mockReturnValue(tmpDir);

        await exportAttributesToCSV(attrs, 'gb.host.test');

        const files = fs.readdirSync(tmpDir);
        const csvFile = files.find(f => f.endsWith('.csv'));
        const content = fs.readFileSync(path.join(tmpDir, csvFile), 'utf-8');
        expect(content).toContain('fallback_val');
    });

    it('replaces commas with semicolons in values', async () => {
        const attrs = [
            { id: 'prefA', description: 'first,second,third' }
        ];

        deriveRealm.mockReturnValue('APAC');
        ensureResultsDir.mockReturnValue(tmpDir);

        await exportAttributesToCSV(attrs, 'apac.host.test');

        const files = fs.readdirSync(tmpDir);
        const csvFile = files.find(f => f.endsWith('.csv'));
        const content = fs.readFileSync(path.join(tmpDir, csvFile), 'utf-8');
        expect(content).toContain('first;second;third');
    });
});

// ============================================================================
// Additional edge cases for writeMatrixCSV
// ============================================================================

describe('writeMatrixCSV edge cases', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log.mockRestore();
    });

    it('handles empty matrix', () => {
        writeMatrixCSV(tmpDir, 'EU05', 'development', [], ['site1']);

        const filePath = path.join(tmpDir, 'EU05_development_preferences_matrix.csv');
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        expect(lines).toHaveLength(1); // header only
        expect(lines[0]).toBe('preferenceId,defaultValue,site1');
    });

    it('marks default value column with X when present', () => {
        const matrix = [
            { preferenceId: 'pref1', defaultValue: 'someDefault', sites: { s1: false } },
            { preferenceId: 'pref2', defaultValue: '', sites: { s1: true } }
        ];

        writeMatrixCSV(tmpDir, 'EU05', 'sandbox', matrix, ['s1']);

        const filePath = path.join(tmpDir, 'EU05_sandbox_preferences_matrix.csv');
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        // pref1 has default → X in column 2; pref2 has no default → empty
        expect(lines[1]).toMatch(/^pref1,X/);
        expect(lines[2]).toMatch(/^pref2,/);
        expect(lines[2]).not.toMatch(/^pref2,X/);
    });
});

// ============================================================================
// Additional edge cases for writeUsageCSV
// ============================================================================

describe('writeUsageCSV edge cases', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log.mockRestore();
    });

    it('returns file path', () => {
        const usageRows = [
            { siteId: 'site1', groupId: 'grp1', preferenceId: 'pA', hasValue: true, value: 'v', defaultValue: '', description: '' }
        ];
        const meta = { pA: { type: 'string' } };

        const result = writeUsageCSV(tmpDir, 'EU05', 'development', usageRows, meta);
        expect(result).toContain('EU05_development');
        expect(result).toContain('_preferences_usage.csv');
    });

    it('aggregates multiple site values for same preference', () => {
        const usageRows = [
            { siteId: 'site1', groupId: 'grp1', preferenceId: 'pA', hasValue: true, value: 'val1', defaultValue: 'def', description: 'desc' },
            { siteId: 'site2', groupId: 'grp1', preferenceId: 'pA', hasValue: true, value: 'val2', defaultValue: 'def', description: 'desc' },
            { siteId: 'site1', groupId: 'grp2', preferenceId: 'pB', hasValue: false, value: '', defaultValue: '', description: '' }
        ];
        const meta = { pA: { type: 'string' }, pB: { type: 'boolean' } };

        writeUsageCSV(tmpDir, 'EU05', 'development', usageRows, meta);

        const filePath = path.join(tmpDir, 'EU05_development_preferences_usage.csv');
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Header has value_site1 and value_site2
        expect(lines[0]).toContain('value_site1');
        expect(lines[0]).toContain('value_site2');
        // 2 data rows (pA and pB)
        expect(lines).toHaveLength(3);
    });
});

// ============================================================================
// Additional edge cases for compactValue
// ============================================================================

describe('compactValue edge cases', () => {
    it('handles empty string', () => {
        expect(compactValue('')).toBe('');
    });

    it('handles arrays', () => {
        expect(compactValue([1, 2, 3])).toBe('[1,2,3]');
    });

    it('handles empty object', () => {
        expect(compactValue({})).toBe('{}');
    });

    it('handles zero', () => {
        expect(compactValue(0)).toBe('0');
    });

    it('handles false', () => {
        expect(compactValue(false)).toBe('false');
    });
});

// ============================================================================
// Additional edge cases for findUnusedPreferences
// ============================================================================

describe('findUnusedPreferences edge cases', () => {
    it('treats lowercase x as used', () => {
        const csvData = [
            ['preferenceId', 'defaultValue', 'site1'],
            ['pref1', '', 'x']
        ];
        const unused = findUnusedPreferences(csvData);
        expect(unused).toEqual([]);
    });

    it('warns and returns empty when preferenceId column missing', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const csvData = [
            ['wrongHeader', 'defaultValue', 'site1'],
            ['pref1', '', '']
        ];
        const unused = findUnusedPreferences(csvData);
        expect(unused).toEqual([]);
        console.warn.mockRestore();
    });

    it('skips rows with empty preferenceId', () => {
        const csvData = [
            ['preferenceId', 'defaultValue', 'site1'],
            ['', '', 'X'],
            ['valid', '', '']
        ];
        const unused = findUnusedPreferences(csvData);
        expect(unused).toEqual(['valid']);
    });
});
