import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock API module
vi.mock('../../../src/api/api.js', () => ({
    updateAttributeDefinitionById: vi.fn()
}));

// Mock backupUtils
vi.mock('../../../src/io/backupUtils.js', () => ({
    loadBackupFile: vi.fn()
}));

// Mock restoreHelper
vi.mock('../../../src/commands/preferences/helpers/restoreHelper.js', () => ({
    restorePreferencesForRealm: vi.fn()
}));

// Mock backupHelpers (validateAndCorrectBackup)
vi.mock('../../../src/commands/preferences/helpers/backupHelpers.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        // Keep getBackupFilePath and classifyRealmBackupStatus as real
        // (they're the ones we're testing)
    };
});

import {
    getBackupFilePath,
    classifyRealmBackupStatus,
    deletePreferencesForRealms
} from '../../../src/commands/preferences/helpers/deleteHelpers.js';
import { updateAttributeDefinitionById } from '../../../src/api/api.js';

// ============================================================================
// getBackupFilePath
// ============================================================================

describe('getBackupFilePath', () => {
    it('constructs path with today\'s date by default', () => {
        const today = new Date().toISOString().split('T')[0];
        const result = getBackupFilePath('EU05', 'SitePreferences', 'development');

        expect(result).toContain('backup');
        expect(result).toContain('development');
        expect(result).toContain(`EU05_SitePreferences_backup_${today}.json`);
    });

    it('uses custom date when provided', () => {
        const result = getBackupFilePath('EU05', 'SitePreferences', 'development', '2026-03-04');

        expect(result).toContain('EU05_SitePreferences_backup_2026-03-04.json');
    });

    it('uses the correct instance type subdirectory', () => {
        const devPath = getBackupFilePath('EU05', 'SitePreferences', 'development');
        const sandboxPath = getBackupFilePath('EU05', 'SitePreferences', 'sandbox');

        expect(devPath).toContain(path.join('backup', 'development'));
        expect(sandboxPath).toContain(path.join('backup', 'sandbox'));
    });

    it('includes realm name in filename', () => {
        const result = getBackupFilePath('APAC', 'SitePreferences', 'staging');

        expect(path.basename(result)).toMatch(/^APAC_SitePreferences_backup_/);
    });
});

// ============================================================================
// classifyRealmBackupStatus
// ============================================================================

describe('classifyRealmBackupStatus', () => {
    let tmpDir;
    let originalCwd;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-status-'));
        originalCwd = process.cwd();
        // Change to tmpDir so getBackupFilePath resolves relative to it
        process.chdir(tmpDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('classifies realms with existing backups', () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(
            path.join(backupDir, `EU05_SitePreferences_backup_${today}.json`),
            '{}', 'utf-8'
        );

        const result = classifyRealmBackupStatus(
            ['EU05', 'APAC'], 'SitePreferences', 'development'
        );

        expect(result.withBackups).toEqual(['EU05']);
        expect(result.withoutBackups).toEqual(['APAC']);
    });

    it('returns all as withoutBackups when no backup files exist', () => {
        const result = classifyRealmBackupStatus(
            ['EU05', 'APAC'], 'SitePreferences', 'development'
        );

        expect(result.withBackups).toEqual([]);
        expect(result.withoutBackups).toEqual(['EU05', 'APAC']);
    });

    it('returns all as withBackups when all backup files exist', () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        for (const realm of ['EU05', 'APAC']) {
            fs.writeFileSync(
                path.join(backupDir, `${realm}_SitePreferences_backup_${today}.json`),
                '{}', 'utf-8'
            );
        }

        const result = classifyRealmBackupStatus(
            ['EU05', 'APAC'], 'SitePreferences', 'development'
        );

        expect(result.withBackups).toEqual(['EU05', 'APAC']);
        expect(result.withoutBackups).toEqual([]);
    });
});

// ============================================================================
// deletePreferencesForRealms
// ============================================================================

describe('deletePreferencesForRealms', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        updateAttributeDefinitionById.mockReset();
    });

    afterEach(() => {
        console.log.mockRestore();
        vi.restoreAllMocks();
    });

    it('deletes preferences via OCAPI for each realm', async () => {
        updateAttributeDefinitionById.mockResolvedValue(true);

        const realmPreferenceMap = new Map([
            ['EU05', ['c_prefA', 'c_prefB']],
            ['APAC', ['c_prefA']]
        ]);

        const result = await deletePreferencesForRealms({
            realmPreferenceMap,
            objectType: 'SitePreferences'
        });

        expect(result.totalDeleted).toBe(3);
        expect(result.totalFailed).toBe(0);
        expect(updateAttributeDefinitionById).toHaveBeenCalledTimes(3);
    });

    it('counts failures when API returns false', async () => {
        updateAttributeDefinitionById
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        const realmPreferenceMap = new Map([
            ['EU05', ['c_good', 'c_bad']]
        ]);

        const result = await deletePreferencesForRealms({
            realmPreferenceMap,
            objectType: 'SitePreferences'
        });

        expect(result.totalDeleted).toBe(1);
        expect(result.totalFailed).toBe(1);
    });

    it('skips realms with empty preference lists', async () => {
        const realmPreferenceMap = new Map([
            ['EU05', []],
            ['APAC', ['c_prefA']]
        ]);

        updateAttributeDefinitionById.mockResolvedValue(true);

        const result = await deletePreferencesForRealms({
            realmPreferenceMap,
            objectType: 'SitePreferences'
        });

        expect(result.totalDeleted).toBe(1);
        expect(updateAttributeDefinitionById).toHaveBeenCalledTimes(1);
    });

    it('simulates deletion in dry-run mode without calling API', async () => {
        const realmPreferenceMap = new Map([
            ['EU05', ['c_prefA', 'c_prefB']]
        ]);

        const result = await deletePreferencesForRealms({
            realmPreferenceMap,
            objectType: 'SitePreferences',
            dryRun: true
        });

        expect(result.totalDeleted).toBe(2);
        expect(result.totalFailed).toBe(0);
        expect(updateAttributeDefinitionById).not.toHaveBeenCalled();
    });

    it('passes correct parameters to OCAPI', async () => {
        updateAttributeDefinitionById.mockResolvedValue(true);

        const realmPreferenceMap = new Map([
            ['EU05', ['c_testPref']]
        ]);

        await deletePreferencesForRealms({
            realmPreferenceMap,
            objectType: 'SitePreferences'
        });

        expect(updateAttributeDefinitionById).toHaveBeenCalledWith(
            'SitePreferences',
            'c_testPref',
            'delete',
            null,
            'EU05'
        );
    });
});
