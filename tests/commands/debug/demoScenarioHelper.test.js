import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../../../src/config/constants.js', () => ({
    DIRECTORIES: { BACKUP: 'backup', RESULTS: 'results' },
    FILE_PATTERNS: { BACKUP_SUFFIX: '_backup_' },
    IDENTIFIERS: { SITE_PREFERENCES: 'SitePreferences', CUSTOM_ATTRIBUTE_PREFIX: 'c_' },
    LOG_PREFIX: { INFO: '✓', WARNING: '⚠', ERROR: '✗' }
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getInstanceType: vi.fn(() => 'development'),
    getCoreSiteTemplatePath: vi.fn(() => 'sites/site_template')
}));

vi.mock('../../../src/commands/preferences/helpers/restoreHelper.js', () => ({
    restorePreferencesForRealm: vi.fn(() => ({ restored: 2, failed: 0 }))
}));

vi.mock('../../../src/io/backupUtils.js', () => ({
    loadBackupFile: vi.fn(async (filePath) => {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    })
}));

vi.mock('../../../src/commands/setup/helpers/whitelistHelper.js', () => ({
    loadWhitelist: vi.fn(() => ({ description: 'Original', whitelist: [] })),
    saveWhitelist: vi.fn(),
    addToWhitelist: vi.fn(() => true)
}));

vi.mock('../../../src/commands/preferences/helpers/deleteHelpers.js', () => ({
    deletePreferencesForRealms: vi.fn(() => ({ totalDeleted: 2, totalFailed: 0 }))
}));

import {
    buildDemoBackup,
    writeDemoBackups,
    getDemoAttributeIds,
    replaceDemoWhitelist,
    restorePreviousWhitelist,
    buildDemoMetaXml,
    writeDemoMetaFile,
    buildDemoCodeReference,
    writeDemoCodeReference,
    saveScenarioState,
    loadScenarioState,
    removeScenarioState,
    deleteDemoAttributes,
    removeDemoArtifacts,
    removeDemoBackups
} from '../../../src/commands/debug/helpers/demoScenarioHelper.js';
import { loadWhitelist, saveWhitelist, addToWhitelist } from '../../../src/commands/setup/helpers/whitelistHelper.js';
import { deletePreferencesForRealms } from '../../../src/commands/preferences/helpers/deleteHelpers.js';

let tmpDir;
let originalCwd;

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
});

afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

// ============================================================================
// buildDemoBackup
// ============================================================================

describe('buildDemoBackup', () => {
    it('produces a valid backup shape for a realm', () => {
        const backup = buildDemoBackup('EU05', 'development');

        expect(backup.realm).toBe('EU05');
        expect(backup.instance_type).toBe('development');
        expect(backup.object_type).toBe('SitePreferences');
        expect(backup.total_attributes).toBe(2);
        expect(backup.attributes).toHaveLength(2);
        expect(backup.attribute_groups).toHaveLength(1);
    });

    it('includes shared and realm-specific attributes', () => {
        const backup = buildDemoBackup('APAC', 'development');
        const ids = backup.attributes.map(a => a.id);

        expect(ids).toContain('DemoTestSharedAttribute');
        expect(ids).toContain('DemoTestAPACAttribute');
    });

    it('assigns all attributes to the demo group', () => {
        const backup = buildDemoBackup('GB', 'development');
        const group = backup.attribute_groups[0];

        expect(group.group_id).toBe('DemoTestGroup');
        expect(group.attributes).toHaveLength(2);
        expect(group.attributes).toContain('DemoTestSharedAttribute');
        expect(group.attributes).toContain('DemoTestGBAttribute');
    });
});

// ============================================================================
// writeDemoBackups
// ============================================================================

describe('writeDemoBackups', () => {
    it('writes backup JSON files for each realm', () => {
        const paths = writeDemoBackups(['EU05', 'APAC'], 'development');

        expect(paths.size).toBe(2);
        for (const [realm, filePath] of paths) {
            expect(fs.existsSync(filePath)).toBe(true);
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(content.realm).toBe(realm);
        }
    });

    it('creates backup directory if missing', () => {
        const backupDir = path.join(tmpDir, 'backup', 'development');
        expect(fs.existsSync(backupDir)).toBe(false);

        writeDemoBackups(['EU05'], 'development');

        expect(fs.existsSync(backupDir)).toBe(true);
    });
});

// ============================================================================
// getDemoAttributeIds
// ============================================================================

describe('getDemoAttributeIds', () => {
    it('returns shared + realm-specific IDs', () => {
        const ids = getDemoAttributeIds(['EU05', 'APAC']);

        expect(ids).toHaveLength(3);
        expect(ids).toContain('DemoTestSharedAttribute');
        expect(ids).toContain('DemoTestEU05Attribute');
        expect(ids).toContain('DemoTestAPACAttribute');
    });

    it('returns only shared ID for empty realms', () => {
        const ids = getDemoAttributeIds([]);

        expect(ids).toHaveLength(1);
        expect(ids).toContain('DemoTestSharedAttribute');
    });
});

// ============================================================================
// replaceDemoWhitelist + restorePreviousWhitelist
// ============================================================================

describe('replaceDemoWhitelist', () => {
    it('saves a snapshot and replaces with demo entries', () => {
        const previous = replaceDemoWhitelist(['EU05']);

        expect(previous).toEqual({ description: 'Original', whitelist: [] });
        expect(saveWhitelist).toHaveBeenCalled();
        expect(addToWhitelist).toHaveBeenCalledTimes(2); // shared + EU05
    });
});

describe('restorePreviousWhitelist', () => {
    it('calls saveWhitelist with the snapshot', () => {
        const snapshot = { description: 'Old', whitelist: [{ id: 'x', type: 'exact' }] };
        restorePreviousWhitelist(snapshot);

        expect(saveWhitelist).toHaveBeenCalledWith(snapshot);
    });
});

// ============================================================================
// buildDemoMetaXml
// ============================================================================

describe('buildDemoMetaXml', () => {
    it('produces valid XML with SitePreferences type-extension', () => {
        const xml = buildDemoMetaXml(['EU05']);

        expect(xml).toContain('<?xml version="1.0"');
        expect(xml).toContain('type-id="SitePreferences"');
        expect(xml).toContain('attribute-id="DemoTestSharedAttribute"');
        expect(xml).toContain('attribute-id="DemoTestEU05Attribute"');
        expect(xml).toContain(`group-id="DemoTestGroup"`);
    });
});

// ============================================================================
// writeDemoMetaFile
// ============================================================================

describe('writeDemoMetaFile', () => {
    it('writes meta XML to core site_template/meta/', () => {
        const repoPath = path.join(tmpDir, 'mock-repo');
        fs.mkdirSync(repoPath, { recursive: true });

        const filePath = writeDemoMetaFile(repoPath, ['EU05']);

        expect(fs.existsSync(filePath)).toBe(true);
        expect(filePath).toContain('meta.demo.sitepreferences.xml');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('SitePreferences');
    });
});

// ============================================================================
// buildDemoCodeReference
// ============================================================================

describe('buildDemoCodeReference', () => {
    it('contains .custom. access patterns for the code scanner', () => {
        const content = buildDemoCodeReference('APAC');

        expect(content).toContain('.custom.DemoTestSharedAttribute');
        expect(content).toContain("'DemoTestAPACAttribute'");
    });
});

// ============================================================================
// writeDemoCodeReference
// ============================================================================

describe('writeDemoCodeReference', () => {
    it('writes JS file inside cartridge scripts dir', () => {
        const repoPath = path.join(tmpDir, 'mock-repo');
        fs.mkdirSync(repoPath, { recursive: true });

        const filePath = writeDemoCodeReference(repoPath, 'app_storefront_base', 'EU05');

        expect(fs.existsSync(filePath)).toBe(true);
        expect(filePath).toContain('demoPreferenceReferences.js');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('DemoTestSharedAttribute');
    });
});

// ============================================================================
// saveScenarioState + loadScenarioState + removeScenarioState
// ============================================================================

describe('scenario state persistence', () => {
    const sampleState = {
        instanceType: 'development',
        realms: ['EU05'],
        repoPath: '/mock/repo',
        cartridgeName: 'app_custom',
        realmForUsage: 'EU05',
        backupPaths: new Map([['EU05', '/mock/backup.json']]),
        previousWhitelist: { whitelist: [] },
        metaFilePath: '/mock/meta.xml',
        codeFilePath: '/mock/code.js',
        attributeIds: ['DemoTestSharedAttribute', 'DemoTestEU05Attribute']
    };

    it('saves and loads scenario state round-trip', () => {
        fs.mkdirSync(path.join(tmpDir, 'results'), { recursive: true });

        saveScenarioState(sampleState);
        const loaded = loadScenarioState();

        expect(loaded.instanceType).toBe('development');
        expect(loaded.realms).toEqual(['EU05']);
        expect(loaded.backupPaths).toBeInstanceOf(Map);
        expect(loaded.backupPaths.get('EU05')).toBe('/mock/backup.json');
    });

    it('returns null when no state file exists', () => {
        const loaded = loadScenarioState();
        expect(loaded).toBeNull();
    });

    it('removes the state file', () => {
        fs.mkdirSync(path.join(tmpDir, 'results'), { recursive: true });
        saveScenarioState(sampleState);

        removeScenarioState();

        expect(loadScenarioState()).toBeNull();
    });
});

// ============================================================================
// deleteDemoAttributes
// ============================================================================

describe('deleteDemoAttributes', () => {
    it('calls deletePreferencesForRealms with all realms and attribute IDs', async () => {
        const state = {
            realms: ['EU05', 'APAC'],
            attributeIds: ['DemoTestSharedAttribute', 'DemoTestEU05Attribute']
        };

        await deleteDemoAttributes(state);

        expect(deletePreferencesForRealms).toHaveBeenCalledWith({
            realmPreferenceMap: expect.any(Map),
            objectType: 'SitePreferences',
            dryRun: false
        });
    });
});

// ============================================================================
// removeDemoArtifacts
// ============================================================================

describe('removeDemoArtifacts', () => {
    it('removes meta and code files when they exist', () => {
        const metaPath = path.join(tmpDir, 'meta.xml');
        const codePath = path.join(tmpDir, 'code.js');
        fs.writeFileSync(metaPath, '<xml/>', 'utf-8');
        fs.writeFileSync(codePath, '// code', 'utf-8');

        const result = removeDemoArtifacts({
            metaFilePath: metaPath,
            codeFilePath: codePath
        });

        expect(result.metaRemoved).toBe(true);
        expect(result.codeRemoved).toBe(true);
        expect(fs.existsSync(metaPath)).toBe(false);
        expect(fs.existsSync(codePath)).toBe(false);
    });

    it('returns false when files do not exist', () => {
        const result = removeDemoArtifacts({
            metaFilePath: '/nonexistent/meta.xml',
            codeFilePath: '/nonexistent/code.js'
        });

        expect(result.metaRemoved).toBe(false);
        expect(result.codeRemoved).toBe(false);
    });
});

// ============================================================================
// removeDemoBackups
// ============================================================================

describe('removeDemoBackups', () => {
    it('removes backup files that exist', () => {
        const backupPath = path.join(tmpDir, 'backup.json');
        fs.writeFileSync(backupPath, '{}', 'utf-8');

        removeDemoBackups({
            backupPaths: new Map([['EU05', backupPath]])
        });

        expect(fs.existsSync(backupPath)).toBe(false);
    });
});
