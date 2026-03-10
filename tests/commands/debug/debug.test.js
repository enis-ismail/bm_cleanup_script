import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Heavy mocking — debug.js imports many modules
vi.mock('../../../src/helpers/timer.js', () => ({
    startTimer: vi.fn(() => ({ stop: vi.fn(() => '0.5s') }))
}));

vi.mock('../../../src/scripts/loggingScript/progressDisplay.js', () => ({
    RealmProgressDisplay: vi.fn(function() {
        return {
            start: vi.fn(),
            stop: vi.fn(),
            finish: vi.fn(),
            startStep: vi.fn(),
            completeStep: vi.fn(),
            failStep: vi.fn(),
            failRealm: vi.fn(),
            completeRealm: vi.fn(),
            setStepProgress: vi.fn(),
            setTotalSteps: vi.fn(),
            setStepMessage: vi.fn()
        };
    })
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
    realmPrompt: vi.fn(() => [{ name: 'realm', message: 'Realm?' }]),
    objectTypePrompt: vi.fn(() => [{ name: 'objectType', message: 'Object type?' }]),
    instanceTypePrompt: vi.fn(() => [{ name: 'instanceType', message: 'Instance type?' }]),
    repositoryPrompt: vi.fn(() => [{ name: 'repository', message: 'Repo?' }]),
    preferenceIdPrompt: vi.fn(() => [{ name: 'preferenceId', message: 'Pref?' }]),
    groupIdPrompt: vi.fn(() => [{ name: 'groupId', message: 'Group?' }])
}));

vi.mock('path', async () => {
    const actual = await vi.importActual('path');
    return {
        ...actual,
        default: actual,
        join: actual.join,
        dirname: actual.dirname,
        basename: actual.basename
    };
});

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        statSync: vi.fn(() => ({ mtimeMs: Date.now() }))
    },
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ mtimeMs: Date.now() }))
}));

vi.mock('../../../src/io/util.js', () => ({
    findAllMatrixFiles: vi.fn(() => []),
    getSiblingRepositories: vi.fn(() => [])
}));

vi.mock('../../../src/io/codeScanner.js', () => ({
    getActivePreferencesFromMatrices: vi.fn(() => new Set()),
    findPreferenceUsage: vi.fn(() => ({
        preferenceId: 'testPref',
        repositoryPath: '/mock/repo',
        deprecatedCartridgesCount: 0,
        totalMatches: 0,
        cartridges: []
    }))
}));

vi.mock('../../../src/io/siteXmlHelper.js', () => ({
    findAttributeInMetaFiles: vi.fn(() => [])
}));

vi.mock('../../../src/helpers/backupJob.js', () => ({
    refreshMetadataBackupForRealm: vi.fn(),
    getMetadataBackupPathForRealm: vi.fn(() => '/mock/backup.xml')
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getInstanceType: vi.fn(() => 'development'),
    getRealmsByInstanceType: vi.fn(() => [])
}));

vi.mock('../../../src/commands/debug/helpers/endpointHealthCheck.js', () => ({
    checkAllRealmEndpoints: vi.fn(() => []),
    checkRealmEndpoints: vi.fn(() => ({ realm: 'EU05', endpoints: [] })),
    buildHealthReport: vi.fn(() => ({ report: 'All OK', actionItems: [] }))
}));

vi.mock('inquirer', () => ({
    default: { prompt: vi.fn() }
}));

import { registerDebugCommands } from '../../../src/commands/debug/debug.js';
import inquirer from 'inquirer';
import { getAttributeGroups, getAttributeGroupById, getAttributeDefinitionById, updateAttributeDefinitionById, patchSitePreferencesGroup } from '../../../src/api/api.js';
import { findAllMatrixFiles, getSiblingRepositories } from '../../../src/io/util.js';
import { getActivePreferencesFromMatrices, findPreferenceUsage } from '../../../src/io/codeScanner.js';
import { findAttributeInMetaFiles } from '../../../src/io/siteXmlHelper.js';
import { checkAllRealmEndpoints, checkRealmEndpoints, buildHealthReport } from '../../../src/commands/debug/helpers/endpointHealthCheck.js';
import fs from 'fs';

// Helper to trigger a debug command
async function triggerCommand(commandName, args = []) {
    const program = new Command();
    program.exitOverride();
    registerDebugCommands(program);
    await program.parseAsync(['node', 'test', commandName, ...args]);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

    it('check-api-endpoints has --realm option', () => {
        const program = new Command();
        registerDebugCommands(program);
        const cmd = program.commands.find(c => c.name() === 'check-api-endpoints');
        const optionNames = cmd.options.map(o => o.long);
        expect(optionNames).toContain('--realm');
    });

    it('list-attribute-groups has --verbose option', () => {
        const program = new Command();
        registerDebugCommands(program);
        const cmd = program.commands.find(c => c.name() === 'list-attribute-groups');
        const optionNames = cmd.options.map(o => o.long);
        expect(optionNames).toContain('--verbose');
    });
});

// ============================================================================
// listAttributeGroups — command flow
// ============================================================================

describe('listAttributeGroups', () => {
    it('calls getAttributeGroups and writes output to file', async () => {
        const mockGroups = [
            { id: 'group1', display_name: 'Group One', attribute_definitions: [{ id: 'attr1' }] }
        ];
        getAttributeGroups.mockResolvedValue(mockGroups);

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' });

        await triggerCommand('list-attribute-groups');

        expect(getAttributeGroups).toHaveBeenCalledWith('SitePreferences', 'EU05');
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('exits early when no groups found', async () => {
        getAttributeGroups.mockResolvedValue([]);

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' });

        await triggerCommand('list-attribute-groups');

        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('exits early when groups is null', async () => {
        getAttributeGroups.mockResolvedValue(null);

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' });

        await triggerCommand('list-attribute-groups');

        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
});

// ============================================================================
// getAttributeGroup — command flow
// ============================================================================

describe('getAttributeGroup', () => {
    it('calls getAttributeGroupById and writes output', async () => {
        const mockGroup = {
            id: 'testGroup',
            display_name: 'Test',
            attribute_definitions: [{ id: 'attr1' }]
        };
        getAttributeGroupById.mockResolvedValue(mockGroup);

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' })
            .mockResolvedValueOnce({ groupId: 'testGroup' });

        await triggerCommand('get-attribute-group');

        expect(getAttributeGroupById).toHaveBeenCalledWith(
            'SitePreferences', 'testGroup', 'EU05'
        );
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('exits early when group not found', async () => {
        getAttributeGroupById.mockResolvedValue(null);

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' })
            .mockResolvedValueOnce({ groupId: 'nonexistent' });

        await triggerCommand('get-attribute-group');

        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
});

// ============================================================================
// testActivePreferences — command flow
// ============================================================================

describe('testActivePreferences', () => {
    it('calls findAllMatrixFiles and displays active preferences', async () => {
        findAllMatrixFiles.mockReturnValue([
            { matrixFile: '/mock/EU05_matrix.csv' }
        ]);
        getActivePreferencesFromMatrices.mockReturnValue(
            new Set(['pref_a', 'pref_b'])
        );

        await triggerCommand('test-active-preferences');

        expect(findAllMatrixFiles).toHaveBeenCalled();
        expect(getActivePreferencesFromMatrices).toHaveBeenCalledWith([
            '/mock/EU05_matrix.csv'
        ]);
    });

    it('exits early when no matrix files found', async () => {
        findAllMatrixFiles.mockReturnValue([]);

        await triggerCommand('test-active-preferences');

        expect(getActivePreferencesFromMatrices).not.toHaveBeenCalled();
    });
});

// ============================================================================
// findPreferenceUsage — command flow
// ============================================================================

describe('findPreferenceUsageCommand', () => {
    it('exits early when no sibling repositories found', async () => {
        getSiblingRepositories.mockResolvedValue([]);

        await triggerCommand('find-preference-usage');

        expect(findPreferenceUsage).not.toHaveBeenCalled();
    });

    it('calls findPreferenceUsage with correct args', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ preferenceId: 'testPref' });

        findPreferenceUsage.mockResolvedValue({
            preferenceId: 'testPref',
            repositoryPath: '/mock/repo',
            deprecatedCartridgesCount: 1,
            totalMatches: 3,
            cartridges: ['app_storefront', 'int_payment']
        });

        await triggerCommand('find-preference-usage');

        expect(findPreferenceUsage).toHaveBeenCalledWith(
            'testPref',
            expect.any(String)
        );
    });
});

// ============================================================================
// testPatchAttribute — command flow
// ============================================================================

describe('testPatchAttribute', () => {
    it('calls updateAttributeDefinitionById with patch method', async () => {
        updateAttributeDefinitionById.mockResolvedValue({ id: 'attr1' });

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' })
            .mockResolvedValueOnce({ attributeId: 'testAttr' })
            .mockResolvedValueOnce({ payloadJson: '{"display_name": "New"}' });

        await triggerCommand('test-patch-attribute');

        expect(updateAttributeDefinitionById).toHaveBeenCalledWith(
            'SitePreferences',
            'testAttr',
            'patch',
            { display_name: 'New' },
            'EU05'
        );
    });

    it('logs failure when patch returns null', async () => {
        updateAttributeDefinitionById.mockResolvedValue(null);

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' })
            .mockResolvedValueOnce({ attributeId: 'testAttr' })
            .mockResolvedValueOnce({ payloadJson: '{}' });

        await triggerCommand('test-patch-attribute');

        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('failed')
        );
    });
});

// ============================================================================
// testPutAttribute — command flow
// ============================================================================

describe('testPutAttribute', () => {
    it('calls updateAttributeDefinitionById with put method', async () => {
        updateAttributeDefinitionById.mockResolvedValue({ id: 'attr1' });

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' })
            .mockResolvedValueOnce({ attributeId: 'testAttr' })
            .mockResolvedValueOnce({ payloadJson: '{"id": "testAttr"}' });

        await triggerCommand('test-put-attribute');

        expect(updateAttributeDefinitionById).toHaveBeenCalledWith(
            'SitePreferences',
            'testAttr',
            'put',
            { id: 'testAttr' },
            'EU05'
        );
    });
});

// ============================================================================
// testDeleteAttribute — command flow
// ============================================================================

describe('testDeleteAttribute', () => {
    it('calls updateAttributeDefinitionById with delete when confirmed', async () => {
        updateAttributeDefinitionById.mockResolvedValue(true);

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' })
            .mockResolvedValueOnce({ attributeId: 'testAttr' })
            .mockResolvedValueOnce({ confirm: true });

        await triggerCommand('test-delete-attribute');

        expect(updateAttributeDefinitionById).toHaveBeenCalledWith(
            'SitePreferences',
            'testAttr',
            'delete',
            null,
            'EU05'
        );
    });

    it('does not call delete when user cancels', async () => {
        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ objectType: 'SitePreferences' })
            .mockResolvedValueOnce({ attributeId: 'testAttr' })
            .mockResolvedValueOnce({ confirm: false });

        await triggerCommand('test-delete-attribute');

        expect(updateAttributeDefinitionById).not.toHaveBeenCalled();
    });
});

// ============================================================================
// testSetSitePreference — command flow
// ============================================================================

describe('testSetSitePreference', () => {
    it('calls patchSitePreferencesGroup with c_ prefix', async () => {
        patchSitePreferencesGroup.mockResolvedValue({ result: 'ok' });

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ siteId: 'SiteA' })
            .mockResolvedValueOnce({ groupId: 'TestGroup' })
            .mockResolvedValueOnce({ instanceType: 'development' })
            .mockResolvedValueOnce({ attributeId: 'testAttr', value: 'hello' });

        await triggerCommand('test-set-site-preference');

        expect(patchSitePreferencesGroup).toHaveBeenCalledWith(
            'SiteA',
            'TestGroup',
            'development',
            { c_testAttr: 'hello' },
            'EU05'
        );
    });

    it('does not double-prefix when attribute already has c_', async () => {
        patchSitePreferencesGroup.mockResolvedValue({ result: 'ok' });

        inquirer.prompt
            .mockResolvedValueOnce({ realm: 'EU05' })
            .mockResolvedValueOnce({ siteId: 'SiteA' })
            .mockResolvedValueOnce({ groupId: 'TestGroup' })
            .mockResolvedValueOnce({ instanceType: 'development' })
            .mockResolvedValueOnce({ attributeId: 'c_testAttr', value: 'hello' });

        await triggerCommand('test-set-site-preference');

        expect(patchSitePreferencesGroup).toHaveBeenCalledWith(
            'SiteA',
            'TestGroup',
            'development',
            { c_testAttr: 'hello' },
            'EU05'
        );
    });
});

// ============================================================================
// findAttributeGroupInMeta — command flow
// ============================================================================

describe('findAttributeGroupInMeta', () => {
    it('exits early when no sibling repositories', async () => {
        getSiblingRepositories.mockResolvedValue([]);

        await triggerCommand('find-attribute-group-in-meta');

        expect(findAttributeInMetaFiles).not.toHaveBeenCalled();
    });

    it('calls findAttributeInMetaFiles with correct args', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        findAttributeInMetaFiles.mockResolvedValue([
            { siteFolder: 'sites/EU', relativePath: 'meta.xml', filePath: '/full/path', groupId: 'g1' }
        ]);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ preferenceId: 'testAttr' });

        await triggerCommand('find-attribute-group-in-meta');

        expect(findAttributeInMetaFiles).toHaveBeenCalledWith(
            expect.any(String),
            'testAttr'
        );
    });

    it('logs not-found message when no results', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        findAttributeInMetaFiles.mockResolvedValue([]);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ preferenceId: 'missing' });

        await triggerCommand('find-attribute-group-in-meta');

        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('not found')
        );
    });
});

// ============================================================================
// checkApiEndpoints — command flow
// ============================================================================

describe('checkApiEndpoints', () => {
    it('calls checkAllRealmEndpoints when no --realm option', async () => {
        checkAllRealmEndpoints.mockResolvedValue([
            { realm: 'EU05', endpoints: [] }
        ]);
        buildHealthReport.mockReturnValue({ report: 'OK', actionItems: [] });

        await triggerCommand('check-api-endpoints');

        expect(checkAllRealmEndpoints).toHaveBeenCalled();
        expect(checkRealmEndpoints).not.toHaveBeenCalled();
    });

    it('calls checkRealmEndpoints when --realm option provided', async () => {
        checkRealmEndpoints.mockResolvedValue({ realm: 'EU05', endpoints: [] });
        buildHealthReport.mockReturnValue({ report: 'OK', actionItems: [] });

        await triggerCommand('check-api-endpoints', ['--realm', 'EU05']);

        expect(checkRealmEndpoints).toHaveBeenCalledWith('EU05');
        expect(checkAllRealmEndpoints).not.toHaveBeenCalled();
    });

    it('shows tip when action items exist', async () => {
        checkAllRealmEndpoints.mockResolvedValue([
            { realm: 'EU05', endpoints: [{ url: '/test', status: 200 }] }
        ]);
        buildHealthReport.mockReturnValue({
            report: 'Issues found',
            actionItems: ['Fix EU05']
        });

        await triggerCommand('check-api-endpoints');

        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('Tip')
        );
    });

    it('shows no-realms message when results are empty', async () => {
        checkAllRealmEndpoints.mockResolvedValue([]);
        buildHealthReport.mockReturnValue({ report: '', actionItems: [] });

        await triggerCommand('check-api-endpoints');

        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('No realms configured')
        );
    });
});
