import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Heavy mocking — debug.js imports many modules
vi.mock('../../../src/helpers/timer.js', () => ({
    startTimer: vi.fn(() => ({ stop: vi.fn(() => '0.5s') }))
}));

vi.mock('../../../src/scripts/loggingScript/progressDisplay.js', () => ({
    RealmProgressDisplay: vi.fn()
}));

vi.mock('../../../src/api/api.js', () => ({
    updateAttributeDefinitionById: vi.fn(),
    patchSitePreferencesGroup: vi.fn(),
    getAttributeDefinitionById: vi.fn(),
    assignAttributeToGroup: vi.fn(),
    getAttributeGroups: vi.fn(),
    getAttributeGroupById: vi.fn()
}));

vi.mock('../../../src/io/backupUtils.js', () => ({
    loadBackupFile: vi.fn()
}));

vi.mock('../../../src/commands/prompts/index.js', () => ({
    realmPrompt: vi.fn(),
    objectTypePrompt: vi.fn(),
    instanceTypePrompt: vi.fn(),
    repositoryPrompt: vi.fn(),
    preferenceIdPrompt: vi.fn(),
    groupIdPrompt: vi.fn()
}));

vi.mock('../../../src/io/util.js', () => ({
    findAllMatrixFiles: vi.fn(),
    getSiblingRepositories: vi.fn(() => [])
}));

vi.mock('../../../src/io/codeScanner.js', () => ({
    getActivePreferencesFromMatrices: vi.fn(),
    findPreferenceUsage: vi.fn()
}));

vi.mock('../../../src/io/siteXmlHelper.js', () => ({
    findAttributeInMetaFiles: vi.fn()
}));

vi.mock('../../../src/helpers/backupJob.js', () => ({
    refreshMetadataBackupForRealm: vi.fn(),
    getMetadataBackupPathForRealm: vi.fn()
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getInstanceType: vi.fn(),
    getRealmsByInstanceType: vi.fn(() => [])
}));

vi.mock('../../../src/commands/debug/helpers/endpointHealthCheck.js', () => ({
    checkAllRealmEndpoints: vi.fn(),
    checkRealmEndpoints: vi.fn(),
    buildHealthReport: vi.fn()
}));

vi.mock('inquirer', () => ({
    default: { prompt: vi.fn() }
}));

import { registerDebugCommands } from '../../../src/commands/debug/debug.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// registerDebugCommands
// ============================================================================

describe('registerDebugCommands', () => {
    it('registers all 14 debug commands', () => {
        const program = new Command();
        program.exitOverride();
        registerDebugCommands(program);
        expect(program.commands).toHaveLength(14);
    });

    it('registers list-attribute-groups command', () => {
        const program = new Command();
        registerDebugCommands(program);
        expect(program.commands.find(c => c.name() === 'list-attribute-groups')).toBeDefined();
    });

    it('registers get-attribute-group command', () => {
        const program = new Command();
        registerDebugCommands(program);
        expect(program.commands.find(c => c.name() === 'get-attribute-group')).toBeDefined();
    });

    it('registers test-active-preferences command', () => {
        const program = new Command();
        registerDebugCommands(program);
        expect(program.commands.find(c => c.name() === 'test-active-preferences')).toBeDefined();
    });

    it('registers find-preference-usage command', () => {
        const program = new Command();
        registerDebugCommands(program);
        expect(program.commands.find(c => c.name() === 'find-preference-usage')).toBeDefined();
    });

    it('registers check-api-endpoints command', () => {
        const program = new Command();
        registerDebugCommands(program);
        expect(program.commands.find(c => c.name() === 'check-api-endpoints')).toBeDefined();
    });

    it('registers test-backup-restore-cycle command', () => {
        const program = new Command();
        registerDebugCommands(program);
        expect(program.commands.find(c => c.name() === 'test-backup-restore-cycle')).toBeDefined();
    });

    it('registers all expected command names', () => {
        const program = new Command();
        registerDebugCommands(program);

        const expectedNames = [
            'list-attribute-groups',
            'get-attribute-group',
            'test-active-preferences',
            'find-preference-usage',
            'test-patch-attribute',
            'test-put-attribute',
            'test-delete-attribute',
            'test-set-site-preference',
            'test-backup-restore-cycle',
            'find-attribute-group-in-meta',
            'test-generate-backup-json',
            'test-concurrent-timers',
            'debug-progress',
            'check-api-endpoints'
        ];

        const actualNames = program.commands.map(c => c.name());
        for (const name of expectedNames) {
            expect(actualNames).toContain(name);
        }
    });
});
