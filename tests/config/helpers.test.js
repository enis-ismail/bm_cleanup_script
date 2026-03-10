import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Module Mocks
// ============================================================================

vi.mock('../../src/scripts/loggingScript/log.js', () => ({
    logError: vi.fn()
}));

// ============================================================================
// Imports
// ============================================================================

import {
    getSandboxConfig,
    getRealmConfig,
    getAvailableRealms,
    getCoreSiteTemplatePath,
    getInstanceType,
    getRealmsByInstanceType,
    getValidationConfig,
    getBackupConfig,
    getWebdavConfig,
    deriveRealm,
    addRealmToConfig,
    removeRealmFromConfig,
    loadConfig,
    saveConfig,
    findRealmInConfig
} from '../../src/config/helpers/helpers.js';

import { logError } from '../../src/scripts/loggingScript/log.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the config.json path relative to the helpers.js source file.
 * This matches the path used inside loadConfig().
 */
function getConfigPath() {
    return path.resolve(
        path.dirname(new URL('../../src/config/helpers/helpers.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
        '../config.json'
    );
}

/**
 * Build a minimal valid config object for testing.
 */
function buildConfig(overrides = {}) {
    return {
        coreSiteTemplatePath: 'sites/site_template',
        validation: { ignoreBmCartridges: true },
        realms: [
            {
                name: 'EU05',
                hostname: 'eu05.example.com',
                clientId: 'test-client',
                clientSecret: 'test-secret',
                instanceType: 'development'
            },
            {
                name: 'APAC',
                hostname: 'apac.example.com',
                clientId: 'apac-client',
                clientSecret: 'apac-secret',
                instanceType: 'development'
            }
        ],
        backup: {
            jobId: 'site preferences - BACKUP',
            pollIntervalMs: 5000,
            timeoutMs: 600000,
            ocapiVersion: 'v25_6',
            webdavUsername: 'admin',
            webdavPassword: 'pass123',
            webdavFilePath: '/on/demandware.servlet/webdav/Sites/Impex/src/meta_data_backup.xml',
            outputDir: './backup_downloads'
        },
        ...overrides
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('deriveRealm', () => {
    it('extracts realm from hostname', () => {
        expect(deriveRealm('eu05.sandbox.example.com')).toBe('eu05');
    });

    it('returns "realm" for empty string', () => {
        expect(deriveRealm('')).toBe('realm');
    });

    it('returns "realm" for null/undefined', () => {
        expect(deriveRealm(null)).toBe('realm');
        expect(deriveRealm(undefined)).toBe('realm');
    });

    it('handles hostname with no dots', () => {
        expect(deriveRealm('localhost')).toBe('localhost');
    });
});

describe('findRealmInConfig', () => {
    const config = buildConfig();

    it('finds an existing realm by name', () => {
        const realm = findRealmInConfig('EU05', config);
        expect(realm).not.toBeNull();
        expect(realm.hostname).toBe('eu05.example.com');
    });

    it('returns null for a non-existent realm', () => {
        expect(findRealmInConfig('UNKNOWN', config)).toBeNull();
    });
});

describe('loadConfig', () => {
    let configPath;
    let originalContent;

    beforeEach(() => {
        configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            originalContent = fs.readFileSync(configPath, 'utf-8');
        }
    });

    afterEach(() => {
        // Restore original config.json
        if (originalContent !== undefined) {
            fs.writeFileSync(configPath, originalContent);
        }
    });

    it('loads and returns the configuration object', () => {
        const config = loadConfig();
        expect(config).toBeDefined();
        expect(config).toHaveProperty('realms');
        expect(Array.isArray(config.realms)).toBe(true);
    });

    it('backfills missing top-level properties from defaults', () => {
        const config = loadConfig();
        // These should always be present due to backfill
        expect(config).toHaveProperty('coreSiteTemplatePath');
        expect(config).toHaveProperty('validation');
        expect(config).toHaveProperty('backup');
    });

    it('backfills missing nested backup properties', () => {
        // Write a config missing some backup sub-properties
        const partial = {
            realms: [],
            backup: { jobId: 'custom-job' }
        };
        fs.writeFileSync(configPath, JSON.stringify(partial, null, 2));

        const config = loadConfig();
        expect(config.backup.jobId).toBe('custom-job');
        // Backfilled defaults
        expect(config.backup).toHaveProperty('pollIntervalMs');
        expect(config.backup).toHaveProperty('timeoutMs');
    });
});

describe('getSandboxConfig', () => {
    it('returns realm config for a valid realm', () => {
        const realms = getAvailableRealms();
        if (realms.length === 0) return; // skip if no realms configured

        const sandbox = getSandboxConfig(realms[0]);
        expect(sandbox).toHaveProperty('name');
        expect(sandbox).toHaveProperty('hostname');
    });

    it('throws for a non-existent realm', () => {
        expect(() => getSandboxConfig('NONEXISTENT_REALM_XYZ'))
            .toThrow("Realm 'NONEXISTENT_REALM_XYZ' not found in config.json");
    });
});

describe('getRealmConfig', () => {
    it('delegates to getSandboxConfig', () => {
        expect(() => getRealmConfig('NONEXISTENT_REALM_XYZ'))
            .toThrow("Realm 'NONEXISTENT_REALM_XYZ' not found in config.json");
    });
});

describe('getAvailableRealms', () => {
    it('returns an array of realm names', () => {
        const realms = getAvailableRealms();
        expect(Array.isArray(realms)).toBe(true);
        for (const name of realms) {
            expect(typeof name).toBe('string');
        }
    });
});

describe('getCoreSiteTemplatePath', () => {
    it('returns the core site template path', () => {
        const result = getCoreSiteTemplatePath();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });
});

describe('getInstanceType', () => {
    it('throws for a non-existent realm', () => {
        expect(() => getInstanceType('NONEXISTENT_REALM_XYZ'))
            .toThrow("Realm 'NONEXISTENT_REALM_XYZ' not found in config.json");
    });

    it('returns instance type for a valid realm', () => {
        const realms = getAvailableRealms();
        if (realms.length === 0) return;

        const instanceType = getInstanceType(realms[0]);
        expect(typeof instanceType).toBe('string');
    });
});

describe('getRealmsByInstanceType', () => {
    it('returns array of realms for a valid instance type', () => {
        const result = getRealmsByInstanceType('development');
        expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array for unknown instance type', () => {
        const result = getRealmsByInstanceType('nonexistent_type_xyz');
        expect(result).toEqual([]);
    });
});

describe('getValidationConfig', () => {
    it('returns validation config object', () => {
        const validation = getValidationConfig();
        expect(validation).toHaveProperty('ignoreBmCartridges');
    });
});

describe('getBackupConfig', () => {
    it('returns backup config with all expected properties', () => {
        const backup = getBackupConfig();
        expect(backup).toHaveProperty('jobId');
        expect(backup).toHaveProperty('pollIntervalMs');
        expect(backup).toHaveProperty('timeoutMs');
        expect(backup).toHaveProperty('ocapiVersion');
        expect(backup).toHaveProperty('webdavFilePath');
        expect(backup).toHaveProperty('outputDir');
    });

    it('applies defaults for missing backup properties', () => {
        const backup = getBackupConfig();
        expect(typeof backup.jobId).toBe('string');
        expect(typeof backup.pollIntervalMs).toBe('number');
        expect(typeof backup.timeoutMs).toBe('number');
    });
});

describe('getWebdavConfig', () => {
    it('throws for a non-existent realm', () => {
        expect(() => getWebdavConfig('NONEXISTENT_REALM_XYZ'))
            .toThrow("Realm 'NONEXISTENT_REALM_XYZ' not found in config.json");
    });

    it('returns webdav config for a valid realm', () => {
        const realms = getAvailableRealms();
        if (realms.length === 0) return;

        const webdav = getWebdavConfig(realms[0]);
        expect(webdav).toHaveProperty('name');
        expect(webdav).toHaveProperty('hostname');
        expect(webdav).toHaveProperty('username');
        expect(webdav).toHaveProperty('password');
        expect(webdav).toHaveProperty('filePath');
    });
});

describe('addRealmToConfig', () => {
    let configPath;
    let originalContent;

    beforeEach(() => {
        configPath = getConfigPath();
        originalContent = fs.readFileSync(configPath, 'utf-8');
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.writeFileSync(configPath, originalContent);
        vi.restoreAllMocks();
    });

    it('adds a new realm and returns true', () => {
        const result = addRealmToConfig(
            'TEST_REALM_NEW',
            'test.example.com',
            'client-id',
            'client-secret',
            '',
            'sandbox'
        );
        expect(result).toBe(true);

        // Verify it persisted
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const added = config.realms.find(r => r.name === 'TEST_REALM_NEW');
        expect(added).toBeDefined();
        expect(added.hostname).toBe('test.example.com');
        expect(added.instanceType).toBe('sandbox');
    });

    it('adds siteTemplatesPath when provided', () => {
        const result = addRealmToConfig(
            'TEST_REALM_WITH_PATH',
            'test2.example.com',
            'client-id',
            'client-secret',
            'sites/custom_template',
            'development'
        );
        expect(result).toBe(true);

        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const added = config.realms.find(r => r.name === 'TEST_REALM_WITH_PATH');
        expect(added.siteTemplatesPath).toBe('sites/custom_template');
    });

    it('returns false if realm already exists', () => {
        const realms = getAvailableRealms();
        if (realms.length === 0) return;

        const result = addRealmToConfig(
            realms[0],
            'duplicate.example.com',
            'client-id',
            'client-secret'
        );
        expect(result).toBe(false);
    });
});

describe('removeRealmFromConfig', () => {
    let configPath;
    let originalContent;

    beforeEach(() => {
        configPath = getConfigPath();
        originalContent = fs.readFileSync(configPath, 'utf-8');
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.writeFileSync(configPath, originalContent);
        vi.restoreAllMocks();
    });

    it('removes an existing realm and returns true', async () => {
        // First add a realm to remove
        addRealmToConfig('TEMP_REALM_TO_REMOVE', 'temp.example.com', 'cid', 'cs');

        const result = await removeRealmFromConfig('TEMP_REALM_TO_REMOVE');
        expect(result).toBe(true);

        // Verify it's gone
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const found = config.realms.find(r => r.name === 'TEMP_REALM_TO_REMOVE');
        expect(found).toBeUndefined();
    });

    it('returns false for a non-existent realm', async () => {
        const result = await removeRealmFromConfig('NONEXISTENT_REALM_XYZ');
        expect(result).toBe(false);
    });
});

describe('saveConfig', () => {
    let configPath;
    let originalContent;

    beforeEach(() => {
        configPath = getConfigPath();
        originalContent = fs.readFileSync(configPath, 'utf-8');
    });

    afterEach(() => {
        fs.writeFileSync(configPath, originalContent);
    });

    it('writes config to disk', () => {
        const config = loadConfig();
        config._testMarker = 'save-test';
        saveConfig(config);

        const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(written._testMarker).toBe('save-test');
    });
});
