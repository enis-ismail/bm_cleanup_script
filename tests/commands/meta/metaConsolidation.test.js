import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    buildConsolidatedMetaFileName,
    removeOtherXmlFiles,
    formatConsolidationResults,
    consolidateMetaFilesForRealm,
    consolidateMetaFiles
} from '../../../src/commands/meta/helpers/metaConsolidation.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/helpers/backupJob.js', () => ({
    refreshMetadataBackupForRealm: vi.fn()
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getSandboxConfig: vi.fn((realm) => ({
        hostname: `${realm.toLowerCase()}.example.com`,
        instanceType: 'development',
        siteTemplatesPath: `sites/site_template_${realm.toLowerCase()}`
    })),
    getWebdavConfig: vi.fn((realm) => ({
        name: realm,
        hostname: `${realm.toLowerCase()}.example.com`
    }))
}));

// Re-export getRealmMetaDir from metaFileCleanup — it's imported by metaConsolidation
vi.mock('../../../src/commands/meta/helpers/metaFileCleanup.js', () => ({
    getRealmMetaDir: vi.fn((repoPath, siteTemplatesPath) =>
        path.join(repoPath, siteTemplatesPath, 'meta')
    )
}));

import { refreshMetadataBackupForRealm } from '../../../src/helpers/backupJob.js';

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

// ============================================================================
// consolidateMetaFilesForRealm
// ============================================================================

describe('consolidateMetaFilesForRealm', () => {
    let tmpDir;
    let logSpy;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidate-realm-'));
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('returns failure when meta directory does not exist', async () => {
        const result = await consolidateMetaFilesForRealm({
            repoPath: tmpDir,
            realm: 'EU05',
            instanceType: 'development'
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Meta directory not found');
    });

    it('returns failure when backup job fails', async () => {
        // Create meta dir so it passes that check
        const metaDir = path.join(tmpDir, 'sites', 'site_template_eu05', 'meta');
        fs.mkdirSync(metaDir, { recursive: true });
        fs.writeFileSync(path.join(metaDir, 'old.xml'), '<xml/>', 'utf-8');

        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: false,
            reason: 'Job timed out'
        });

        const result = await consolidateMetaFilesForRealm({
            repoPath: tmpDir,
            realm: 'EU05',
            instanceType: 'development'
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Job timed out');
    });

    it('consolidates successfully when backup succeeds', async () => {
        const metaDir = path.join(tmpDir, 'sites', 'site_template_eu05', 'meta');
        fs.mkdirSync(metaDir, { recursive: true });
        fs.writeFileSync(path.join(metaDir, 'old1.xml'), '<old1/>', 'utf-8');
        fs.writeFileSync(path.join(metaDir, 'old2.xml'), '<old2/>', 'utf-8');

        // Create the backup file that the job "downloads"
        const backupFile = path.join(tmpDir, 'backup_meta.xml');
        fs.writeFileSync(backupFile, '<fresh-backup/>', 'utf-8');

        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: true,
            filePath: backupFile
        });

        const result = await consolidateMetaFilesForRealm({
            repoPath: tmpDir,
            realm: 'EU05',
            instanceType: 'development'
        });

        expect(result.ok).toBe(true);
        expect(result.realm).toBe('EU05');
        expect(result.metaFile).toContain('_meta_data.xml');
        expect(result.removed).toContain('old1.xml');
        expect(result.removed).toContain('old2.xml');

        // Verify the consolidated file exists
        const consolidatedPath = path.join(metaDir, result.metaFile);
        expect(fs.existsSync(consolidatedPath)).toBe(true);
        expect(fs.readFileSync(consolidatedPath, 'utf-8')).toBe('<fresh-backup/>');
    });

    it('returns failure when copy fails', async () => {
        const metaDir = path.join(tmpDir, 'sites', 'site_template_eu05', 'meta');
        fs.mkdirSync(metaDir, { recursive: true });

        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: true,
            filePath: '/nonexistent/path/backup.xml'  // will fail to copy
        });

        const result = await consolidateMetaFilesForRealm({
            repoPath: tmpDir,
            realm: 'EU05',
            instanceType: 'development'
        });

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Failed to copy');
    });
});

// ============================================================================
// consolidateMetaFiles
// ============================================================================

describe('consolidateMetaFiles', () => {
    let tmpDir;
    let logSpy;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidate-multi-'));
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('processes multiple realms and counts successes/failures', async () => {
        // EU05: meta dir exists, backup will succeed
        const eu05Meta = path.join(tmpDir, 'sites', 'site_template_eu05', 'meta');
        fs.mkdirSync(eu05Meta, { recursive: true });
        const backupFile = path.join(tmpDir, 'backup.xml');
        fs.writeFileSync(backupFile, '<xml/>', 'utf-8');

        // APAC: no meta dir -> will fail

        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: true,
            filePath: backupFile
        });

        const result = await consolidateMetaFiles({
            repoPath: tmpDir,
            realmList: ['EU05', 'APAC'],
            instanceType: 'development'
        });

        expect(result.results).toHaveLength(2);
        expect(result.successCount).toBe(1);
        expect(result.failCount).toBe(1);
    });

    it('handles empty realm list', async () => {
        const result = await consolidateMetaFiles({
            repoPath: tmpDir,
            realmList: [],
            instanceType: 'development'
        });
        expect(result.results).toHaveLength(0);
        expect(result.successCount).toBe(0);
        expect(result.failCount).toBe(0);
    });
});
