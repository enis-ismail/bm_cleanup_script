import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock external dependencies
vi.mock('../../../src/index.js', () => ({
    getInstanceType: vi.fn((realm) => 'development')
}));

vi.mock('../../../src/scripts/loggingScript/log.js', () => ({
    logSectionTitle: vi.fn()
}));

vi.mock('../../../src/helpers/backupJob.js', () => ({
    refreshMetadataBackupForRealm: vi.fn(),
    getMetadataBackupPathForRealm: vi.fn()
}));

vi.mock('../../../src/commands/preferences/helpers/generateSitePreferences.js', () => ({
    generate: vi.fn()
}));

vi.mock('../../../src/commands/preferences/helpers/csvHelpers.js', () => ({
    findLatestUsageCsv: vi.fn()
}));

import {
    validateAndCorrectBackup,
    findLatestBackupFile,
    resolveMetadataPath,
    createRealmBackup,
    createBackupsForRealms
} from '../../../src/commands/preferences/helpers/backupHelpers.js';
import { getInstanceType } from '../../../src/index.js';
import { refreshMetadataBackupForRealm, getMetadataBackupPathForRealm } from '../../../src/helpers/backupJob.js';
import { generate as generateSitePreferencesBackup } from '../../../src/commands/preferences/helpers/generateSitePreferences.js';
import { findLatestUsageCsv } from '../../../src/commands/preferences/helpers/csvHelpers.js';

// ============================================================================
// validateAndCorrectBackup
// ============================================================================

describe('validateAndCorrectBackup', () => {
    it('returns uncorrected for a valid backup', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_enableFeature',
                    display_name: { default: 'Enable Feature' },
                    description: { default: 'Desc' },
                    default_value: { value: true },
                    value_type: 'boolean'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(false);
        expect(result.corrections).toEqual([]);
        expect(result.backup.attributes[0].display_name).toEqual({ default: 'Enable Feature' });
    });

    it('converts string display_name to object format', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_pref1',
                    display_name: 'My Preference',
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].display_name).toEqual({ default: 'My Preference' });
        expect(result.corrections.some(c => c.includes('display_name'))).toBe(true);
    });

    it('converts string description to object format', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_pref2',
                    description: 'A description',
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].description).toEqual({ default: 'A description' });
    });

    it('cleans xml2js artifacts from description and converts _ to default', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_pref3',
                    description: { _: 'xml content', $: { attr: 'val' } },
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        // The _ value is converted to { default: 'xml content' }
        expect(result.backup.attributes[0].description).toEqual({ default: 'xml content' });
    });

    it('converts string default_value to typed {value: <typed>} for boolean', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_flag',
                    default_value: 'true',
                    value_type: 'boolean'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: true });
    });

    it('converts string default_value to typed {value: <typed>} for int', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_count',
                    default_value: '42',
                    value_type: 'int'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: 42 });
    });

    it('converts string default_value to typed {value: <typed>} for double', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_rate',
                    default_value: '3.14',
                    value_type: 'double'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: 3.14 });
    });

    it('keeps string default_value as string type when value_type is string', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_label',
                    default_value: 'hello',
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: 'hello' });
    });

    it('cleans xml2js artifacts from default_value object', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_setting',
                    default_value: { _: '10', $: { type: 'int' } },
                    value_type: 'integer'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: 10 });
    });

    it('converts default_value with "default" key to {value: <typed>}', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_val',
                    default_value: { default: 'false' },
                    value_type: 'boolean'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: false });
    });

    it('removes xml2js root-level artifacts from attributes', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_dirty',
                    _: 'text',
                    $: { xmlns: 'http://example.com' },
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0]._).toBeUndefined();
        expect(result.backup.attributes[0].$).toBeUndefined();
    });

    it('handles multiple attributes with mixed issues', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_valid',
                    display_name: { default: 'Valid' },
                    value_type: 'string'
                },
                {
                    id: 'c_fixMe',
                    display_name: 'Fix Me',
                    description: 'Needs fix',
                    default_value: '100',
                    value_type: 'int'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        // First attribute should be unchanged
        expect(result.backup.attributes[0].display_name).toEqual({ default: 'Valid' });
        // Second should be corrected
        expect(result.backup.attributes[1].display_name).toEqual({ default: 'Fix Me' });
        expect(result.backup.attributes[1].description).toEqual({ default: 'Needs fix' });
        expect(result.backup.attributes[1].default_value).toEqual({ value: 100 });
    });

    it('does not mutate the original backup object', () => {
        const original = {
            attributes: [
                {
                    id: 'c_pref',
                    display_name: 'String Name',
                    value_type: 'string'
                }
            ]
        };

        validateAndCorrectBackup(original);

        // Original should still be a string
        expect(original.attributes[0].display_name).toBe('String Name');
    });

    it('handles empty attributes array', () => {
        const backup = { attributes: [] };
        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(false);
        expect(result.corrections).toEqual([]);
    });
});

// ============================================================================
// findLatestBackupFile
// ============================================================================

describe('findLatestBackupFile', () => {
    let tmpDir;
    let originalCwd;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-find-'));
        originalCwd = process.cwd();
        process.chdir(tmpDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        getInstanceType.mockReturnValue('development');
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log.mockRestore();
        vi.restoreAllMocks();
    });

    it('returns null when backup directory does not exist', () => {
        const result = findLatestBackupFile('EU05');

        expect(result).toBeNull();
    });

    it('returns null when no matching backup files exist', () => {
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'unrelated_file.json'), '{}');

        const result = findLatestBackupFile('EU05');

        expect(result).toBeNull();
    });

    it('returns the latest backup file when multiple exist', () => {
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        fs.writeFileSync(path.join(backupDir, 'EU05_SitePreferences_backup_2026-03-01.json'), '{}');
        fs.writeFileSync(path.join(backupDir, 'EU05_SitePreferences_backup_2026-03-04.json'), '{}');
        fs.writeFileSync(path.join(backupDir, 'EU05_SitePreferences_backup_2026-03-02.json'), '{}');

        const result = findLatestBackupFile('EU05');

        expect(result).toContain('EU05_SitePreferences_backup_2026-03-04.json');
    });

    it('only matches files for the specified realm', () => {
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        fs.writeFileSync(path.join(backupDir, 'APAC_SitePreferences_backup_2026-03-04.json'), '{}');
        fs.writeFileSync(path.join(backupDir, 'EU05_SitePreferences_backup_2026-03-01.json'), '{}');

        const result = findLatestBackupFile('EU05');

        expect(result).toContain('EU05_SitePreferences_backup_2026-03-01.json');
        expect(result).not.toContain('APAC');
    });

    it('uses getInstanceType to determine the backup subdirectory', () => {
        getInstanceType.mockReturnValue('sandbox');
        const backupDir = path.join(tmpDir, 'backup', 'sandbox');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'EU05_SitePreferences_backup_2026-03-04.json'), '{}');

        const result = findLatestBackupFile('EU05');

        expect(getInstanceType).toHaveBeenCalledWith('EU05');
        expect(result).toContain(path.join('backup', 'sandbox'));
    });

    it('supports custom objectType parameter', () => {
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'EU05_CustomObject_backup_2026-03-04.json'), '{}');

        const result = findLatestBackupFile('EU05', 'CustomObject');

        expect(result).toContain('EU05_CustomObject_backup_2026-03-04.json');
    });
});

// ============================================================================
// resolveMetadataPath
// ============================================================================

describe('resolveMetadataPath', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        getMetadataBackupPathForRealm.mockReset();
        refreshMetadataBackupForRealm.mockReset();
    });

    afterEach(() => {
        console.log.mockRestore();
        vi.restoreAllMocks();
    });

    it('returns existing metadata path when file exists and forceRefresh is false', () => {
        const existingPath = path.join(os.tmpdir(), 'existing_metadata.xml');
        fs.writeFileSync(existingPath, '<xml/>');
        getMetadataBackupPathForRealm.mockReturnValue(existingPath);

        return resolveMetadataPath('EU05', 'development', false).then((result) => {
            expect(result).toEqual({ ok: true, path: existingPath });
            expect(refreshMetadataBackupForRealm).not.toHaveBeenCalled();
            fs.unlinkSync(existingPath);
        });
    });

    it('triggers refresh when forceRefresh is true even if file exists', async () => {
        const existingPath = path.join(os.tmpdir(), 'existing_metadata2.xml');
        fs.writeFileSync(existingPath, '<xml/>');
        getMetadataBackupPathForRealm.mockReturnValue(existingPath);
        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: true,
            filePath: '/refreshed/metadata.xml'
        });

        const result = await resolveMetadataPath('EU05', 'development', true);

        expect(result).toEqual({ ok: true, path: '/refreshed/metadata.xml' });
        expect(refreshMetadataBackupForRealm).toHaveBeenCalledWith(
            'EU05', 'development', { forceJobExecution: true }
        );
        fs.unlinkSync(existingPath);
    });

    it('triggers refresh when metadata file does not exist', async () => {
        getMetadataBackupPathForRealm.mockReturnValue('/nonexistent/path.xml');
        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: true,
            filePath: '/new/metadata.xml'
        });

        const result = await resolveMetadataPath('EU05', 'development', false);

        expect(result).toEqual({ ok: true, path: '/new/metadata.xml' });
        expect(refreshMetadataBackupForRealm).toHaveBeenCalledWith(
            'EU05', 'development', { forceJobExecution: false }
        );
    });

    it('returns failure when refresh fails', async () => {
        getMetadataBackupPathForRealm.mockReturnValue('/nonexistent/path.xml');
        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: false,
            reason: 'Job timed out'
        });

        const result = await resolveMetadataPath('EU05', 'development', false);

        expect(result.ok).toBe(false);
        expect(result.path).toBeNull();
        expect(result.reason).toBe('Job timed out');
    });
});

// ============================================================================
// createRealmBackup
// ============================================================================

describe('createRealmBackup', () => {
    let tmpDir;
    let originalCwd;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-backup-'));
        originalCwd = process.cwd();
        process.chdir(tmpDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        generateSitePreferencesBackup.mockReset();
        findLatestUsageCsv.mockReset();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log.mockRestore();
        vi.restoreAllMocks();
    });

    it('creates backup directory if it does not exist', async () => {
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/path',
            stats: { parsedUniqueIds: 5, parsedInputIds: 5, total: 5, groups: 1, withValues: 2 }
        });

        await createRealmBackup({
            realm: 'EU05',
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            metadataPath: '/mock/metadata.xml',
            backupDate: '2026-03-04'
        });

        const backupDir = path.join(tmpDir, 'backup', 'development');
        expect(fs.existsSync(backupDir)).toBe(true);
    });

    it('calls generateSitePreferencesBackup with correct parameters', async () => {
        const usageCsvPath = '/mock/usage.csv';
        findLatestUsageCsv.mockReturnValue(usageCsvPath);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 3, parsedInputIds: 3, total: 3, groups: 1, withValues: 1 }
        });

        await createRealmBackup({
            realm: 'EU05',
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion_list.txt',
            metadataPath: '/mock/metadata.xml',
            backupDate: '2026-03-04'
        });

        expect(generateSitePreferencesBackup).toHaveBeenCalledWith({
            unusedPreferencesFile: '/mock/deletion_list.txt',
            csvFile: usageCsvPath,
            xmlMetadataFile: '/mock/metadata.xml',
            outputFile: expect.stringContaining('EU05_SitePreferences_backup_2026-03-04.json'),
            realm: 'EU05',
            instanceType: 'development',
            objectType: 'SitePreferences',
            verbose: true
        });
    });

    it('passes all deletion preferences to generateSitePreferencesBackup via unusedPreferencesFile', async () => {
        // This test verifies the core user requirement: the backup generator receives
        // the FULL deletion list file, ensuring all preferences targeted for deletion
        // are included in the backup for safe restoration.
        const deletionFilePath = path.join(tmpDir, 'EU05_preferences_for_deletion.txt');
        const deletionContent = [
            'Site Preferences - Deletion Candidates for EU05',
            '',
            '--- [P1] Safe to Delete (No Code, No Values on EU05) --- 3 preferences',
            'c_unusedPrefA',
            'c_unusedPrefB',
            'c_unusedPrefC',
            '',
            '--- [P2] Likely Safe (No Code, Has Values on EU05) --- 2 preferences',
            'c_valuePrefA  |  has default value  |  sites with values: 3',
            'c_valuePrefB  |  sites with values: 1',
            '',
            '=== End of deletion candidates ==='
        ].join('\n');
        fs.writeFileSync(deletionFilePath, deletionContent);

        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 5, parsedInputIds: 5, total: 5, groups: 1, withValues: 2 }
        });

        await createRealmBackup({
            realm: 'EU05',
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: deletionFilePath,
            metadataPath: '/mock/metadata.xml',
            backupDate: '2026-03-04'
        });

        // The deletion file path is passed directly to generateSitePreferencesBackup
        // which parses it to extract ALL preference IDs. This ensures the backup
        // covers every preference earmarked for deletion.
        expect(generateSitePreferencesBackup).toHaveBeenCalledWith(
            expect.objectContaining({
                unusedPreferencesFile: deletionFilePath
            })
        );
    });

    it('returns success when backup generation succeeds', async () => {
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 5, parsedInputIds: 5, total: 5, groups: 1, withValues: 2 }
        });

        const result = await createRealmBackup({
            realm: 'EU05',
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            metadataPath: '/mock/metadata.xml',
            backupDate: '2026-03-04'
        });

        expect(result).toEqual({ success: true });
    });

    it('returns failure when backup generation fails', async () => {
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: false,
            error: 'Failed to parse metadata'
        });

        const result = await createRealmBackup({
            realm: 'EU05',
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            metadataPath: '/mock/metadata.xml',
            backupDate: '2026-03-04'
        });

        expect(result).toEqual({ success: false, error: 'Failed to parse metadata' });
    });

    it('handles missing usage CSV gracefully (still creates backup)', async () => {
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 2, parsedInputIds: 2, total: 2, groups: 0, withValues: 0 }
        });

        const result = await createRealmBackup({
            realm: 'EU05',
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            metadataPath: '/mock/metadata.xml'
        });

        expect(result.success).toBe(true);
        expect(generateSitePreferencesBackup).toHaveBeenCalledWith(
            expect.objectContaining({ csvFile: null })
        );
    });

    it('uses today\'s date when backupDate is not provided', async () => {
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 1, parsedInputIds: 1, total: 1, groups: 0, withValues: 0 }
        });

        await createRealmBackup({
            realm: 'EU05',
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            metadataPath: '/mock/metadata.xml'
        });

        const today = new Date().toISOString().split('T')[0];
        expect(generateSitePreferencesBackup).toHaveBeenCalledWith(
            expect.objectContaining({
                outputFile: expect.stringContaining(`EU05_SitePreferences_backup_${today}.json`)
            })
        );
    });
});

// ============================================================================
// createBackupsForRealms
// ============================================================================

describe('createBackupsForRealms', () => {
    let tmpDir;
    let originalCwd;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realms-backup-'));
        originalCwd = process.cwd();
        process.chdir(tmpDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        getMetadataBackupPathForRealm.mockReset();
        refreshMetadataBackupForRealm.mockReset();
        generateSitePreferencesBackup.mockReset();
        findLatestUsageCsv.mockReset();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log.mockRestore();
        vi.restoreAllMocks();
    });

    it('creates backups for all realms and returns success count', async () => {
        getMetadataBackupPathForRealm.mockImplementation((realm) => {
            const p = path.join(tmpDir, `${realm}_metadata.xml`);
            fs.writeFileSync(p, '<xml/>', 'utf-8');
            return p;
        });
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 3, parsedInputIds: 3, total: 3, groups: 1, withValues: 1 }
        });

        const result = await createBackupsForRealms({
            realmsToBackup: ['EU05', 'APAC'],
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            refreshMetadata: false
        });

        expect(result.successCount).toBe(2);
        expect(result.totalCount).toBe(2);
        expect(generateSitePreferencesBackup).toHaveBeenCalledTimes(2);
    });

    it('uses per-realm file paths from realmFilePaths map', async () => {
        const realmFilePaths = new Map([
            ['EU05', '/mock/EU05_deletion.txt'],
            ['APAC', '/mock/APAC_deletion.txt']
        ]);

        getMetadataBackupPathForRealm.mockImplementation((realm) => {
            const p = path.join(tmpDir, `${realm}_metadata.xml`);
            fs.writeFileSync(p, '<xml/>', 'utf-8');
            return p;
        });
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 2, parsedInputIds: 2, total: 2, groups: 1, withValues: 0 }
        });

        await createBackupsForRealms({
            realmsToBackup: ['EU05', 'APAC'],
            instanceType: 'development',
            objectType: 'SitePreferences',
            realmFilePaths,
            refreshMetadata: false
        });

        // Each realm's call should use its own deletion file
        const calls = generateSitePreferencesBackup.mock.calls;
        expect(calls[0][0].unusedPreferencesFile).toBe('/mock/EU05_deletion.txt');
        expect(calls[1][0].unusedPreferencesFile).toBe('/mock/APAC_deletion.txt');
    });

    it('falls back to preferencesFilePath when realm not in realmFilePaths map', async () => {
        const realmFilePaths = new Map([
            ['EU05', '/mock/EU05_deletion.txt']
        ]);

        getMetadataBackupPathForRealm.mockImplementation((realm) => {
            const p = path.join(tmpDir, `${realm}_metadata.xml`);
            fs.writeFileSync(p, '<xml/>', 'utf-8');
            return p;
        });
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 2, parsedInputIds: 2, total: 2, groups: 1, withValues: 0 }
        });

        await createBackupsForRealms({
            realmsToBackup: ['EU05', 'APAC'],
            instanceType: 'development',
            objectType: 'SitePreferences',
            realmFilePaths,
            preferencesFilePath: '/mock/fallback_deletion.txt',
            refreshMetadata: false
        });

        const calls = generateSitePreferencesBackup.mock.calls;
        expect(calls[0][0].unusedPreferencesFile).toBe('/mock/EU05_deletion.txt');
        expect(calls[1][0].unusedPreferencesFile).toBe('/mock/fallback_deletion.txt');
    });

    it('skips realm when no deletion file path is available', async () => {
        getMetadataBackupPathForRealm.mockReturnValue(path.join(tmpDir, 'meta.xml'));
        findLatestUsageCsv.mockReturnValue(null);

        const result = await createBackupsForRealms({
            realmsToBackup: ['EU05'],
            instanceType: 'development',
            objectType: 'SitePreferences',
            // No realmFilePaths and no preferencesFilePath
            refreshMetadata: false
        });

        expect(result.successCount).toBe(0);
        expect(result.totalCount).toBe(1);
        expect(generateSitePreferencesBackup).not.toHaveBeenCalled();
    });

    it('skips realm when metadata resolution fails', async () => {
        getMetadataBackupPathForRealm.mockReturnValue('/nonexistent/metadata.xml');
        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: false,
            reason: 'Job timed out'
        });

        const result = await createBackupsForRealms({
            realmsToBackup: ['EU05'],
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            refreshMetadata: false
        });

        expect(result.successCount).toBe(0);
        expect(result.totalCount).toBe(1);
    });

    it('counts only successful backups in successCount', async () => {
        getMetadataBackupPathForRealm.mockImplementation((realm) => {
            const p = path.join(tmpDir, `${realm}_metadata.xml`);
            fs.writeFileSync(p, '<xml/>', 'utf-8');
            return p;
        });
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup
            .mockResolvedValueOnce({
                success: true,
                outputPath: '/mock/backup1.json',
                stats: { parsedUniqueIds: 2, parsedInputIds: 2, total: 2, groups: 1, withValues: 0 }
            })
            .mockResolvedValueOnce({
                success: false,
                error: 'Parse error'
            });

        const result = await createBackupsForRealms({
            realmsToBackup: ['EU05', 'APAC'],
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            refreshMetadata: false
        });

        expect(result.successCount).toBe(1);
        expect(result.totalCount).toBe(2);
    });

    it('forces metadata refresh when refreshMetadata is true', async () => {
        getMetadataBackupPathForRealm.mockReturnValue(path.join(tmpDir, 'meta.xml'));
        refreshMetadataBackupForRealm.mockResolvedValue({
            ok: true,
            filePath: path.join(tmpDir, 'fresh_meta.xml')
        });
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 1, parsedInputIds: 1, total: 1, groups: 0, withValues: 0 }
        });

        await createBackupsForRealms({
            realmsToBackup: ['EU05'],
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            refreshMetadata: true
        });

        expect(refreshMetadataBackupForRealm).toHaveBeenCalledWith(
            'EU05', 'development', { forceJobExecution: true }
        );
    });

    it('ensures each realm backup uses the same backupDate for consistency', async () => {
        getMetadataBackupPathForRealm.mockImplementation((realm) => {
            const p = path.join(tmpDir, `${realm}_metadata.xml`);
            fs.writeFileSync(p, '<xml/>', 'utf-8');
            return p;
        });
        findLatestUsageCsv.mockReturnValue(null);
        generateSitePreferencesBackup.mockResolvedValue({
            success: true,
            outputPath: '/mock/backup.json',
            stats: { parsedUniqueIds: 1, parsedInputIds: 1, total: 1, groups: 0, withValues: 0 }
        });

        await createBackupsForRealms({
            realmsToBackup: ['EU05', 'APAC', 'GB'],
            instanceType: 'development',
            objectType: 'SitePreferences',
            preferencesFilePath: '/mock/deletion.txt',
            refreshMetadata: false
        });

        // All calls should have the same date in the output file name
        const calls = generateSitePreferencesBackup.mock.calls;
        const datePattern = /backup_(\d{4}-\d{2}-\d{2})\.json$/;
        const dates = calls.map(c => c[0].outputFile.match(datePattern)[1]);
        expect(new Set(dates).size).toBe(1);
    });
});
