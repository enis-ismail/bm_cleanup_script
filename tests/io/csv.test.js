import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    compactValue,
    findUnusedPreferences,
    writeMatrixCSV,
    writeUsageCSV,
    writeUnusedPreferencesFile,
    parseCSVToNestedArray
} from '../../src/io/csv.js';

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
});
