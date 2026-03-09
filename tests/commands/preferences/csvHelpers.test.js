import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/config/constants.js', () => ({
    DIRECTORIES: { RESULTS: 'results' },
    FILE_PATTERNS: { PREFERENCES_USAGE: '_preferences_usage.csv' }
}));

import { findLatestUsageCsv } from '../../../src/commands/preferences/helpers/csvHelpers.js';

// ============================================================================
// Tests
// ============================================================================

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-helpers-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('findLatestUsageCsv', () => {
    it('returns null when realm directory does not exist', () => {
        const result = findLatestUsageCsv('EU05', 'development');
        expect(result).toBeNull();
    });

    it('returns null when no CSV files match the pattern', () => {
        const realmDir = path.join(tmpDir, 'results', 'development', 'EU05');
        fs.mkdirSync(realmDir, { recursive: true });
        fs.writeFileSync(path.join(realmDir, 'other.csv'), 'data');

        const result = findLatestUsageCsv('EU05', 'development');
        expect(result).toBeNull();
    });

    it('returns the only matching CSV file', () => {
        const realmDir = path.join(tmpDir, 'results', 'development', 'EU05');
        fs.mkdirSync(realmDir, { recursive: true });
        const csvFile = path.join(realmDir, 'EU05_preferences_usage.csv');
        fs.writeFileSync(csvFile, 'data');

        const result = findLatestUsageCsv('EU05', 'development');
        expect(result).toBe(csvFile);
    });

    it('returns the most recently modified file when multiple exist', async () => {
        const realmDir = path.join(tmpDir, 'results', 'development', 'EU05');
        fs.mkdirSync(realmDir, { recursive: true });

        const olderFile = path.join(realmDir, 'EU05_old_preferences_usage.csv');
        fs.writeFileSync(olderFile, 'old data');

        // Small delay to ensure different mtimes
        await new Promise(resolve => setTimeout(resolve, 50));

        const newerFile = path.join(realmDir, 'EU05_new_preferences_usage.csv');
        fs.writeFileSync(newerFile, 'new data');

        const result = findLatestUsageCsv('EU05', 'development');
        expect(result).toBe(newerFile);
    });
});
