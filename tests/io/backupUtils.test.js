import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('../../src/config/constants.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        DIRECTORIES: { ...actual.DIRECTORIES, BACKUP: 'backup' },
        BACKUP_CONFIG: { MAX_AGE_DAYS: 14, MS_PER_DAY: 86400000 }
    };
});

import {
    buildCreateSafeBody,
    loadBackupFile,
    checkBackupFileAge,
    loadCachedBackup
} from '../../src/io/backupUtils.js';

// ============================================================================
// buildCreateSafeBody
// ============================================================================

describe('buildCreateSafeBody', () => {
    it('keeps only create-safe fields', () => {
        const fullDef = {
            id: 'myPref',
            display_name: { default: 'My Preference' },
            description: { default: 'A test preference' },
            value_type: 'string',
            mandatory: false,
            localizable: false,
            visible: true,
            queryable: false,
            searchable: false,
            site_specific: true,
            default_value: 'hello',
            // Read-only fields that should be stripped
            _type: 'object',
            _resource_state: 'existing',
            link: '/some/url',
            system: false,
            externally_managed: false
        };

        const result = buildCreateSafeBody(fullDef);

        expect(result.id).toBe('myPref');
        expect(result.display_name).toEqual({ default: 'My Preference' });
        expect(result.value_type).toBe('string');
        expect(result.mandatory).toBe(false);
        expect(result.default_value).toBe('hello');
        expect(result.visible).toBe(true);
        expect(result.site_specific).toBe(true);

        // Verify read-only fields are stripped
        expect(result._type).toBeUndefined();
        expect(result._resource_state).toBeUndefined();
        expect(result.link).toBeUndefined();
        expect(result.system).toBeUndefined();
        expect(result.externally_managed).toBeUndefined();
    });

    it('includes value_definitions when present', () => {
        const def = {
            id: 'enumPref',
            value_type: 'enum_of_string',
            value_definitions: [
                { id: 'opt1', value: 'Option 1' },
                { id: 'opt2', value: 'Option 2' }
            ]
        };

        const result = buildCreateSafeBody(def);
        expect(result.value_definitions).toHaveLength(2);
    });

    it('includes min/max length and value fields', () => {
        const def = {
            id: 'constrainedPref',
            value_type: 'string',
            min_length: 1,
            max_length: 255,
            min_value: 0,
            max_value: 100
        };

        const result = buildCreateSafeBody(def);
        expect(result.min_length).toBe(1);
        expect(result.max_length).toBe(255);
        expect(result.min_value).toBe(0);
        expect(result.max_value).toBe(100);
    });

    it('omits undefined optional fields', () => {
        const def = { id: 'minimalPref' };

        const result = buildCreateSafeBody(def);
        expect(result.id).toBe('minimalPref');
        expect(Object.keys(result)).toEqual(['id']);
    });

    it('preserves multi_value_type field', () => {
        const def = {
            id: 'multiPref',
            value_type: 'set_of_string',
            multi_value_type: true
        };

        const result = buildCreateSafeBody(def);
        expect(result.multi_value_type).toBe(true);
    });
});

// ============================================================================
// loadBackupFile
// ============================================================================

describe('loadBackupFile', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads and validates a valid backup file', async () => {
        const backup = {
            backup_date: '2026-03-04T10:00:00Z',
            realm: 'EU05',
            object_type: 'SitePreferences',
            attributes: [{ id: 'pref1' }],
            attribute_groups: [{ id: 'Group1' }]
        };

        const filePath = path.join(tmpDir, 'backup.json');
        fs.writeFileSync(filePath, JSON.stringify(backup), 'utf-8');

        const result = await loadBackupFile(filePath);

        expect(result.realm).toBe('EU05');
        expect(result.attributes).toHaveLength(1);
        expect(result.attribute_groups).toHaveLength(1);
    });

    it('throws for missing required field', async () => {
        const incomplete = {
            backup_date: '2026-03-04T10:00:00Z',
            realm: 'EU05'
            // missing object_type, attributes, attribute_groups
        };

        const filePath = path.join(tmpDir, 'incomplete.json');
        fs.writeFileSync(filePath, JSON.stringify(incomplete), 'utf-8');

        await expect(loadBackupFile(filePath)).rejects.toThrow('missing required field');
    });

    it('throws for invalid JSON', async () => {
        const filePath = path.join(tmpDir, 'bad.json');
        fs.writeFileSync(filePath, 'not json at all', 'utf-8');

        await expect(loadBackupFile(filePath)).rejects.toThrow();
    });

    it('throws for nonexistent file', async () => {
        await expect(loadBackupFile('/nonexistent/file.json')).rejects.toThrow();
    });
});

// ============================================================================
// checkBackupFileAge
// ============================================================================

describe('checkBackupFileAge', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-age-test-'));
        vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('returns exists=false when backup file does not exist', async () => {
        const result = await checkBackupFileAge('EU05', 'development', 'SitePreferences');

        expect(result.exists).toBe(false);
        expect(result.ageInDays).toBeNull();
        expect(result.backup).toBeNull();
    });

    it('returns exists=true with age for existing backup', async () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        const backup = {
            backup_date: new Date().toISOString(),
            realm: 'EU05',
            object_type: 'SitePreferences',
            attributes: [{ id: 'pref1' }],
            attribute_groups: [{ id: 'Group1' }]
        };

        const filename = `EU05_SitePreferences_backup_${today}.json`;
        fs.writeFileSync(path.join(backupDir, filename), JSON.stringify(backup), 'utf-8');

        const result = await checkBackupFileAge('EU05', 'development', 'SitePreferences');

        expect(result.exists).toBe(true);
        expect(result.ageInDays).toBe(0);
        expect(result.backup.realm).toBe('EU05');
    });
});

// ============================================================================
// loadCachedBackup
// ============================================================================

describe('loadCachedBackup', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cached-backup-test-'));
        vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('returns null when no backup exists', async () => {
        const result = await loadCachedBackup('EU05', 'development', 'SitePreferences');
        expect(result).toBeNull();
    });

    it('returns attributes array when backup exists', async () => {
        const today = new Date().toISOString().split('T')[0];
        const backupDir = path.join(tmpDir, 'backup', 'development');
        fs.mkdirSync(backupDir, { recursive: true });

        const attributes = [
            { id: 'pref1', value_type: 'string' },
            { id: 'pref2', value_type: 'boolean' }
        ];

        const backup = {
            backup_date: new Date().toISOString(),
            realm: 'EU05',
            object_type: 'SitePreferences',
            attributes,
            attribute_groups: [{ id: 'Group1' }]
        };

        const filename = `EU05_SitePreferences_backup_${today}.json`;
        fs.writeFileSync(path.join(backupDir, filename), JSON.stringify(backup), 'utf-8');

        const result = await loadCachedBackup('EU05', 'development', 'SitePreferences');

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('pref1');
        expect(result[1].id).toBe('pref2');
    });
});
