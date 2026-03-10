import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock child_process
vi.mock('child_process', () => ({
    spawn: vi.fn()
}));

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
    deletePreferencesForRealms,
    restorePreferencesFromBackups,
    runAnalyzePreferencesSubprocess
} from '../../../src/commands/preferences/helpers/deleteHelpers.js';
import { spawn } from 'child_process';
import { updateAttributeDefinitionById } from '../../../src/api/api.js';
import { loadBackupFile } from '../../../src/io/backupUtils.js';
import { restorePreferencesForRealm } from '../../../src/commands/preferences/helpers/restoreHelper.js';

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

// ============================================================================
// restorePreferencesFromBackups
// ============================================================================

describe('restorePreferencesFromBackups', () => {
    let tmpDir;
    let originalCwd;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-backup-'));
        originalCwd = process.cwd();
        process.chdir(tmpDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        loadBackupFile.mockReset();
        restorePreferencesForRealm.mockReset();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log.mockRestore();
        vi.restoreAllMocks();
    });

    it('restores preferences from backup for each realm', async () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        const backupData = {
            attributes: [
                { id: 'c_prefA', display_name: { default: 'Pref A' }, value_type: 'boolean' },
                { id: 'c_prefB', display_name: { default: 'Pref B' }, value_type: 'string' }
            ]
        };

        // Create backup files for both realms
        for (const realm of ['EU05', 'APAC']) {
            fs.writeFileSync(
                path.join(backupDir, `${realm}_SitePreferences_backup_${today}.json`),
                JSON.stringify(backupData)
            );
        }

        loadBackupFile.mockResolvedValue(backupData);
        restorePreferencesForRealm.mockResolvedValue({ restored: 2, failed: 0 });

        const result = await restorePreferencesFromBackups({
            realmsToProcess: ['EU05', 'APAC'],
            preferences: ['c_prefA', 'c_prefB'],
            objectType: 'SitePreferences',
            instanceType: 'development'
        });

        expect(result.totalRestored).toBe(4);
        expect(result.totalFailed).toBe(0);
        expect(restorePreferencesForRealm).toHaveBeenCalledTimes(2);
    });

    it('passes correct parameters to restorePreferencesForRealm', async () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        const backupData = {
            attributes: [
                { id: 'c_prefA', display_name: { default: 'Pref A' }, value_type: 'boolean' }
            ]
        };

        fs.writeFileSync(
            path.join(backupDir, `EU05_SitePreferences_backup_${today}.json`),
            JSON.stringify(backupData)
        );

        loadBackupFile.mockResolvedValue(backupData);
        restorePreferencesForRealm.mockResolvedValue({ restored: 1, failed: 0 });

        await restorePreferencesFromBackups({
            realmsToProcess: ['EU05'],
            preferences: ['c_prefA'],
            objectType: 'SitePreferences',
            instanceType: 'development'
        });

        expect(restorePreferencesForRealm).toHaveBeenCalledWith({
            preferenceIds: ['c_prefA'],
            backup: backupData,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });
    });

    it('skips realm when backup file does not exist', async () => {
        // No backup file created on disk

        const result = await restorePreferencesFromBackups({
            realmsToProcess: ['EU05'],
            preferences: ['c_prefA'],
            objectType: 'SitePreferences',
            instanceType: 'development'
        });

        expect(result.totalRestored).toBe(0);
        expect(result.totalFailed).toBe(0);
        expect(loadBackupFile).not.toHaveBeenCalled();
        expect(restorePreferencesForRealm).not.toHaveBeenCalled();
    });

    it('applies backup validation and uses corrected backup when needed', async () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        // Backup with string display_name that needs correction
        const rawBackup = {
            attributes: [
                { id: 'c_prefA', display_name: 'Raw String Name', value_type: 'string' }
            ]
        };

        fs.writeFileSync(
            path.join(backupDir, `EU05_SitePreferences_backup_${today}.json`),
            JSON.stringify(rawBackup)
        );

        loadBackupFile.mockResolvedValue(rawBackup);
        restorePreferencesForRealm.mockResolvedValue({ restored: 1, failed: 0 });

        await restorePreferencesFromBackups({
            realmsToProcess: ['EU05'],
            preferences: ['c_prefA'],
            objectType: 'SitePreferences',
            instanceType: 'development'
        });

        // The backup passed to restorePreferencesForRealm should have corrected display_name
        const calledBackup = restorePreferencesForRealm.mock.calls[0][0].backup;
        expect(calledBackup.attributes[0].display_name).toEqual({ default: 'Raw String Name' });
    });

    it('accumulates restored and failed counts across realms', async () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        const backupData = {
            attributes: [{ id: 'c_prefA', value_type: 'string' }]
        };

        for (const realm of ['EU05', 'APAC', 'GB']) {
            fs.writeFileSync(
                path.join(backupDir, `${realm}_SitePreferences_backup_${today}.json`),
                JSON.stringify(backupData)
            );
        }

        loadBackupFile.mockResolvedValue(backupData);
        restorePreferencesForRealm
            .mockResolvedValueOnce({ restored: 3, failed: 1 })
            .mockResolvedValueOnce({ restored: 2, failed: 0 })
            .mockResolvedValueOnce({ restored: 1, failed: 2 });

        const result = await restorePreferencesFromBackups({
            realmsToProcess: ['EU05', 'APAC', 'GB'],
            preferences: ['c_prefA', 'c_prefB', 'c_prefC'],
            objectType: 'SitePreferences',
            instanceType: 'development'
        });

        expect(result.totalRestored).toBe(6);
        expect(result.totalFailed).toBe(3);
    });

    it('continues processing remaining realms when one backup is missing', async () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        const backupData = {
            attributes: [{ id: 'c_prefA', value_type: 'string' }]
        };

        // Only create backup for APAC, not for EU05
        fs.writeFileSync(
            path.join(backupDir, `APAC_SitePreferences_backup_${today}.json`),
            JSON.stringify(backupData)
        );

        loadBackupFile.mockResolvedValue(backupData);
        restorePreferencesForRealm.mockResolvedValue({ restored: 1, failed: 0 });

        const result = await restorePreferencesFromBackups({
            realmsToProcess: ['EU05', 'APAC'],
            preferences: ['c_prefA'],
            objectType: 'SitePreferences',
            instanceType: 'development'
        });

        // EU05 skipped (no backup), APAC restored
        expect(result.totalRestored).toBe(1);
        expect(restorePreferencesForRealm).toHaveBeenCalledTimes(1);
        expect(restorePreferencesForRealm).toHaveBeenCalledWith(
            expect.objectContaining({ realm: 'APAC' })
        );
    });

    it('uses today\'s date for backup file path', async () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        const backupData = { attributes: [] };
        const expectedFilename = `EU05_SitePreferences_backup_${today}.json`;
        fs.writeFileSync(path.join(backupDir, expectedFilename), JSON.stringify(backupData));

        loadBackupFile.mockResolvedValue(backupData);
        restorePreferencesForRealm.mockResolvedValue({ restored: 0, failed: 0 });

        await restorePreferencesFromBackups({
            realmsToProcess: ['EU05'],
            preferences: [],
            objectType: 'SitePreferences',
            instanceType: 'development'
        });

        expect(loadBackupFile).toHaveBeenCalledWith(
            expect.stringContaining(expectedFilename)
        );
    });
});

// ============================================================================
// runAnalyzePreferencesSubprocess
// ============================================================================

describe('runAnalyzePreferencesSubprocess', () => {
    let logSpy;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('resolves true when subprocess exits with code 0', async () => {
        const mockProcess = {
            on: vi.fn((event, callback) => {
                if (event === 'close') {
                    setTimeout(() => callback(0), 0);
                }
            })
        };
        spawn.mockReturnValue(mockProcess);

        const result = await runAnalyzePreferencesSubprocess();
        expect(result).toBe(true);
        expect(spawn).toHaveBeenCalledWith(
            'node',
            ['src/main.js', 'analyze-preferences'],
            expect.objectContaining({ stdio: 'inherit', shell: true })
        );
    });

    it('rejects when subprocess exits with non-zero code', async () => {
        const mockProcess = {
            on: vi.fn((event, callback) => {
                if (event === 'close') {
                    setTimeout(() => callback(1), 0);
                }
            })
        };
        spawn.mockReturnValue(mockProcess);

        await expect(runAnalyzePreferencesSubprocess()).rejects.toThrow('exited with code 1');
    });

    it('rejects when subprocess emits error', async () => {
        const mockProcess = {
            on: vi.fn((event, callback) => {
                if (event === 'error') {
                    setTimeout(() => callback(new Error('spawn failed')), 0);
                }
            })
        };
        spawn.mockReturnValue(mockProcess);

        await expect(runAnalyzePreferencesSubprocess()).rejects.toThrow('spawn failed');
    });
});
