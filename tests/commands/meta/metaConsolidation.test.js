import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    buildConsolidatedMetaFileName,
    removeOtherXmlFiles,
    formatConsolidationResults
} from '../../../src/commands/meta/helpers/metaConsolidation.js';

// ============================================================================
// buildConsolidatedMetaFileName
// ============================================================================

describe('buildConsolidatedMetaFileName', () => {
    it('creates filename from hostname', () => {
        const result = buildConsolidatedMetaFileName('eu05-realm.example.com');
        expect(result).toBe('eu05-realm.example.com_meta_data.xml');
    });

    it('sanitizes special characters', () => {
        const result = buildConsolidatedMetaFileName('host/with:special@chars');
        expect(result).toBe('host-with-special-chars_meta_data.xml');
    });

    it('handles empty/null input', () => {
        expect(buildConsolidatedMetaFileName(null)).toBe('unknown_meta_data.xml');
        expect(buildConsolidatedMetaFileName(undefined)).toBe('unknown_meta_data.xml');
        expect(buildConsolidatedMetaFileName('')).toBe('unknown_meta_data.xml');
    });

    it('preserves alphanumeric, dots, and hyphens', () => {
        const result = buildConsolidatedMetaFileName('my-host.123');
        expect(result).toBe('my-host.123_meta_data.xml');
    });
});

// ============================================================================
// removeOtherXmlFiles
// ============================================================================

describe('removeOtherXmlFiles', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidation-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('removes XML files except the one to keep', () => {
        fs.writeFileSync(path.join(tmpDir, 'keep.xml'), '<xml/>', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'remove1.xml'), '<xml/>', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'remove2.xml'), '<xml/>', 'utf-8');

        const result = removeOtherXmlFiles(tmpDir, 'keep.xml');

        expect(result.kept).toBe('keep.xml');
        expect(result.removed).toHaveLength(2);
        expect(result.removed).toContain('remove1.xml');
        expect(result.removed).toContain('remove2.xml');

        expect(fs.existsSync(path.join(tmpDir, 'keep.xml'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'remove1.xml'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'remove2.xml'))).toBe(false);
    });

    it('does not remove non-XML files', () => {
        fs.writeFileSync(path.join(tmpDir, 'keep.xml'), '<xml/>', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'text', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}', 'utf-8');

        const result = removeOtherXmlFiles(tmpDir, 'keep.xml');

        expect(result.removed).toEqual([]);
        expect(fs.existsSync(path.join(tmpDir, 'readme.txt'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'config.json'))).toBe(true);
    });

    it('does not remove directories even if named .xml', () => {
        fs.writeFileSync(path.join(tmpDir, 'keep.xml'), '<xml/>', 'utf-8');
        fs.mkdirSync(path.join(tmpDir, 'subdir.xml'));

        const result = removeOtherXmlFiles(tmpDir, 'keep.xml');

        expect(result.removed).toEqual([]);
        expect(fs.existsSync(path.join(tmpDir, 'subdir.xml'))).toBe(true);
    });

    it('handles empty directory', () => {
        const result = removeOtherXmlFiles(tmpDir, 'keep.xml');

        expect(result.removed).toEqual([]);
        expect(result.kept).toBe('keep.xml');
    });

    it('handles case when keep file is not present', () => {
        fs.writeFileSync(path.join(tmpDir, 'other.xml'), '<xml/>', 'utf-8');

        const result = removeOtherXmlFiles(tmpDir, 'keep.xml');

        expect(result.removed).toHaveLength(1);
        expect(result.removed).toContain('other.xml');
    });
});

// ============================================================================
// formatConsolidationResults
// ============================================================================

describe('formatConsolidationResults', () => {
    it('formats successful results', () => {
        const input = {
            results: [
                { ok: true, realm: 'EU05', metaFile: 'host_meta_data.xml', removed: ['old1.xml', 'old2.xml'] }
            ],
            successCount: 1,
            failCount: 0
        };

        const output = formatConsolidationResults(input);

        expect(output).toContain('EU05');
        expect(output).toContain('host_meta_data.xml');
        expect(output).toContain('2 file(s) removed');
        expect(output).toContain('1 succeeded, 0 failed');
    });

    it('formats failed results', () => {
        const input = {
            results: [
                { ok: false, realm: 'APAC', reason: 'No config found' }
            ],
            successCount: 0,
            failCount: 1
        };

        const output = formatConsolidationResults(input);

        expect(output).toContain('APAC');
        expect(output).toContain('No config found');
        expect(output).toContain('0 succeeded, 1 failed');
    });

    it('formats mixed results', () => {
        const input = {
            results: [
                { ok: true, realm: 'EU05', metaFile: 'eu_meta.xml', removed: [] },
                { ok: false, realm: 'GB', reason: 'Meta dir not found' }
            ],
            successCount: 1,
            failCount: 1
        };

        const output = formatConsolidationResults(input);

        expect(output).toContain('EU05');
        expect(output).toContain('GB');
        expect(output).toContain('1 succeeded, 1 failed');
    });
});
