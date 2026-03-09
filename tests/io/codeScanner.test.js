import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getActivePreferencesFromMatrices } from '../../src/io/codeScanner.js';

// ============================================================================
// getActivePreferencesFromMatrices
// ============================================================================

describe('getActivePreferencesFromMatrices', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('extracts unique preference IDs from a single matrix file', () => {
        const csvContent = [
            'preferenceId,defaultValue,site1,site2',
            'enableSearch,,X,',
            'maxResults,50,,X',
            'unusedPref,,,'
        ].join('\n');

        const filePath = path.join(tmpDir, 'matrix.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = getActivePreferencesFromMatrices([filePath]);

        expect(result).toBeInstanceOf(Set);
        expect(result.size).toBe(3);
        expect(result.has('enableSearch')).toBe(true);
        expect(result.has('maxResults')).toBe(true);
        expect(result.has('unusedPref')).toBe(true);
    });

    it('merges preferences from multiple matrix files', () => {
        const csv1 = 'preferenceId,defaultValue,site1\nprefA,,X\nprefB,,';
        const csv2 = 'preferenceId,defaultValue,site1\nprefB,,X\nprefC,,X';

        const file1 = path.join(tmpDir, 'matrix1.csv');
        const file2 = path.join(tmpDir, 'matrix2.csv');
        fs.writeFileSync(file1, csv1, 'utf-8');
        fs.writeFileSync(file2, csv2, 'utf-8');

        const result = getActivePreferencesFromMatrices([file1, file2]);

        expect(result.size).toBe(3);
        expect(result.has('prefA')).toBe(true);
        expect(result.has('prefB')).toBe(true);
        expect(result.has('prefC')).toBe(true);
    });

    it('handles empty files gracefully', () => {
        const filePath = path.join(tmpDir, 'empty.csv');
        fs.writeFileSync(filePath, '', 'utf-8');

        const result = getActivePreferencesFromMatrices([filePath]);
        expect(result.size).toBe(0);
    });

    it('handles header-only files', () => {
        const filePath = path.join(tmpDir, 'header-only.csv');
        fs.writeFileSync(filePath, 'preferenceId,defaultValue,site1', 'utf-8');

        const result = getActivePreferencesFromMatrices([filePath]);
        expect(result.size).toBe(0);
    });

    it('skips non-existent files without error', () => {
        const result = getActivePreferencesFromMatrices(['/nonexistent/file.csv']);
        expect(result.size).toBe(0);
    });

    it('returns empty set for empty input array', () => {
        const result = getActivePreferencesFromMatrices([]);
        expect(result.size).toBe(0);
    });

    it('strips quotes from CSV field values', () => {
        const csvContent = 'preferenceId,defaultValue\n"quotedPref","someDefault"';
        const filePath = path.join(tmpDir, 'quoted.csv');
        fs.writeFileSync(filePath, csvContent, 'utf-8');

        const result = getActivePreferencesFromMatrices([filePath]);
        expect(result.has('quotedPref')).toBe(true);
    });
});
