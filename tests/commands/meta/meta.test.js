import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../../src/helpers/timer.js', () => ({
    startTimer: vi.fn(() => ({ stop: vi.fn(() => '1.2s') }))
}));

vi.mock('../../../src/io/util.js', () => ({
    getSiblingRepositories: vi.fn(() => [])
}));

vi.mock('../../../src/commands/prompts/index.js', () => ({
    repositoryPrompt: vi.fn(() => [{ name: 'repository', type: 'list', choices: [] }]),
    resolveRealmScopeSelection: vi.fn(),
    deletionLevelPrompt: vi.fn(() => [{ name: 'deletionLevel', type: 'list', choices: [] }]),
    deletionSourcePrompt: vi.fn(() => [{ name: 'deletionSource', type: 'list', choices: [] }]),
    confirmExecutionPrompt: vi.fn(() => [{ name: 'confirm', type: 'confirm' }]),
    uncommittedChangesPrompt: vi.fn(() => [{ name: 'proceed', type: 'confirm' }]),
    branchStrategyPrompt: vi.fn(() => [{ name: 'branchStrategy', type: 'list', choices: [] }]),
    baseBranchPrompt: vi.fn(() => [{ name: 'baseBranch', type: 'list', choices: [] }]),
    branchNamePrompt: vi.fn(() => [{ name: 'branchName', type: 'input' }]),
    consolidateMetaPrompt: vi.fn(() => [{ name: 'consolidate', type: 'confirm' }]),
    consolidationFailurePrompt: vi.fn(() => [{ name: 'continueAnyway', type: 'confirm' }]),
    confirmCommitPrompt: vi.fn(() => [{ name: 'confirmCommit', type: 'confirm' }]),
    commitMessagePrompt: vi.fn(() => [{ name: 'commitMsg', type: 'input' }])
}));

vi.mock('../../../src/commands/meta/helpers/metaFileCleanup.js', () => ({
    buildMetaCleanupPlan: vi.fn(() => ({ actions: [{ type: 'remove', file: 'test.xml' }], skipped: [] })),
    executeMetaCleanupPlan: vi.fn(() => ({
        filesModified: ['/mock/test.xml'],
        filesDeleted: [],
        filesCreated: []
    })),
    formatCleanupPlan: vi.fn(() => '  Plan summary'),
    formatExecutionResults: vi.fn(() => '  Execution results'),
    scanSitesForRemainingPreferences: vi.fn(() => ({ found: [] })),
    formatSitesScanResults: vi.fn(() => '  Scan results'),
    removePreferenceValuesFromSites: vi.fn(() => ({
        totalRemoved: 0,
        filesModified: []
    })),
    formatPreferenceValueResults: vi.fn(() => '  Pref value results'),
    stripCustomPrefix: vi.fn(id => id.startsWith('c_') ? id.slice(2) : id)
}));

vi.mock('../../../src/commands/meta/helpers/metaConsolidation.js', () => ({
    consolidateMetaFiles: vi.fn(() => ({
        successCount: 1, failCount: 0, results: []
    })),
    formatConsolidationResults: vi.fn(() => '  Consolidation done')
}));

vi.mock('../../../src/commands/preferences/helpers/preferenceRemoval.js', () => ({
    buildRealmPreferenceMapFromFiles: vi.fn(() => ({
        realmPreferenceMap: new Map([['EU05', ['c_prefA', 'c_prefB']]]),
        blockedByBlacklist: [],
        skippedByWhitelist: [],
        missingRealms: []
    })),
    buildCrossRealmPreferenceMap: vi.fn(() => ({
        realmPreferenceMap: new Map([['EU05', ['c_prefA']]]),
        blockedByBlacklist: [],
        skippedByWhitelist: [],
        missingRealms: []
    }))
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getInstanceType: vi.fn(() => 'development'),
    getRealmsByInstanceType: vi.fn(() => ['EU05', 'APAC'])
}));

vi.mock('../../../src/config/constants.js', () => ({
    TIER_DESCRIPTIONS: { P1: 'Safest', P3: 'Moderate' }
}));

vi.mock('../../../src/commands/meta/helpers/gitHelper.js', () => ({
    getCurrentBranch: vi.fn(() => 'main'),
    listBranches: vi.fn(() => ['main', 'develop']),
    hasUncommittedChanges: vi.fn(() => false),
    getStatusSummary: vi.fn(() => 'M file.js'),
    createAndCheckoutBranch: vi.fn(() => true),
    stageAllChanges: vi.fn(),
    commitChanges: vi.fn(() => true),
    getStagedDiffStat: vi.fn(() => ' 2 files changed'),
    generateCleanupBranchName: vi.fn(() => 'cleanup/P3-development')
}));

vi.mock('inquirer', () => ({
    default: { prompt: vi.fn() }
}));

import { registerMetaCommands } from '../../../src/commands/meta/meta.js';
import inquirer from 'inquirer';
import { getSiblingRepositories } from '../../../src/io/util.js';
import { resolveRealmScopeSelection } from '../../../src/commands/prompts/index.js';
import {
    buildMetaCleanupPlan,
    executeMetaCleanupPlan,
    formatCleanupPlan,
    scanSitesForRemainingPreferences,
    formatSitesScanResults,
    removePreferenceValuesFromSites,
    formatPreferenceValueResults,
    stripCustomPrefix
} from '../../../src/commands/meta/helpers/metaFileCleanup.js';
import {
    buildRealmPreferenceMapFromFiles,
    buildCrossRealmPreferenceMap
} from '../../../src/commands/preferences/helpers/preferenceRemoval.js';
import { getRealmsByInstanceType, getInstanceType } from '../../../src/config/helpers/helpers.js';
import {
    getCurrentBranch,
    hasUncommittedChanges,
    getStatusSummary,
    createAndCheckoutBranch,
    listBranches,
    stageAllChanges,
    commitChanges,
    getStagedDiffStat,
    generateCleanupBranchName
} from '../../../src/commands/meta/helpers/gitHelper.js';
import {
    consolidateMetaFiles,
    formatConsolidationResults
} from '../../../src/commands/meta/helpers/metaConsolidation.js';
import { startTimer } from '../../../src/helpers/timer.js';

// Helper to trigger test-meta-cleanup command
async function triggerTestMetaCleanup(args = []) {
    const program = new Command();
    program.exitOverride();
    registerMetaCommands(program);
    await program.parseAsync(['node', 'test', 'test-meta-cleanup', ...args]);
}

// Helper to trigger meta-cleanup command
async function triggerMetaCleanup() {
    const program = new Command();
    program.exitOverride();
    registerMetaCommands(program);
    await program.parseAsync(['node', 'test', 'meta-cleanup']);
}

/**
 * Re-establish all factory-default mock implementations after vi.resetAllMocks().
 */
function setupDefaults() {
    startTimer.mockReturnValue({ stop: vi.fn(() => '1.2s') });
    getSiblingRepositories.mockReturnValue([]);

    buildMetaCleanupPlan.mockReturnValue({
        actions: [{ type: 'remove', file: 'test.xml' }], skipped: []
    });
    executeMetaCleanupPlan.mockReturnValue({
        filesModified: ['/mock/test.xml'], filesDeleted: [], filesCreated: []
    });
    formatCleanupPlan.mockReturnValue('  Plan summary');
    scanSitesForRemainingPreferences.mockReturnValue({ found: [] });
    formatSitesScanResults.mockReturnValue('  Scan results');
    removePreferenceValuesFromSites.mockReturnValue({ totalRemoved: 0, filesModified: [] });
    formatPreferenceValueResults.mockReturnValue('  Pref value results');
    stripCustomPrefix.mockImplementation(id => id.startsWith('c_') ? id.slice(2) : id);

    consolidateMetaFiles.mockResolvedValue({ successCount: 1, failCount: 0, results: [] });
    formatConsolidationResults.mockReturnValue('  Consolidation done');

    buildRealmPreferenceMapFromFiles.mockReturnValue({
        realmPreferenceMap: new Map([['EU05', ['c_prefA', 'c_prefB']]]),
        blockedByBlacklist: [], skippedByWhitelist: [], missingRealms: []
    });
    buildCrossRealmPreferenceMap.mockReturnValue({
        realmPreferenceMap: new Map([['EU05', ['c_prefA']]]),
        blockedByBlacklist: [], skippedByWhitelist: [], missingRealms: []
    });

    getInstanceType.mockReturnValue('development');
    getRealmsByInstanceType.mockReturnValue(['EU05', 'APAC']);

    getCurrentBranch.mockReturnValue('main');
    listBranches.mockReturnValue(['main', 'develop']);
    hasUncommittedChanges.mockReturnValue(false);
    getStatusSummary.mockReturnValue('M file.js');
    createAndCheckoutBranch.mockReturnValue(true);
    commitChanges.mockReturnValue(true);
    getStagedDiffStat.mockReturnValue(' 2 files changed');
    generateCleanupBranchName.mockReturnValue('cleanup/P3-development');
}

beforeEach(() => {
    vi.resetAllMocks();
    setupDefaults();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================================
// registerMetaCommands
// ============================================================================

describe('registerMetaCommands', () => {
    it('registers test-meta-cleanup command', () => {
        const program = new Command();
        program.exitOverride();
        registerMetaCommands(program);

        const cmd = program.commands.find(c => c.name() === 'test-meta-cleanup');
        expect(cmd).toBeDefined();
        expect(cmd.description()).toContain('meta file cleanup');
    });

    it('registers meta-cleanup command', () => {
        const program = new Command();
        program.exitOverride();
        registerMetaCommands(program);

        const cmd = program.commands.find(c => c.name() === 'meta-cleanup');
        expect(cmd).toBeDefined();
        expect(cmd.description()).toContain('cleanup workflow');
    });

    it('test-meta-cleanup has --dry-run and --execute options', () => {
        const program = new Command();
        program.exitOverride();
        registerMetaCommands(program);

        const cmd = program.commands.find(c => c.name() === 'test-meta-cleanup');
        const optionNames = cmd.options.map(o => o.long);
        expect(optionNames).toContain('--dry-run');
        expect(optionNames).toContain('--execute');
    });

    it('registers exactly 2 commands', () => {
        const program = new Command();
        program.exitOverride();
        registerMetaCommands(program);
        expect(program.commands).toHaveLength(2);
    });
});

// ============================================================================
// testMetaCleanup — command flow
// ============================================================================

describe('testMetaCleanup', () => {
    it('exits early when no sibling repositories found', async () => {
        getSiblingRepositories.mockResolvedValue([]);

        await triggerTestMetaCleanup();

        expect(buildMetaCleanupPlan).not.toHaveBeenCalled();
    });

    it('exits early when no realms selected', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt.mockResolvedValueOnce({ repository: 'repo-a' });
        resolveRealmScopeSelection.mockResolvedValue({ realmList: [], instanceTypeOverride: null });

        await triggerTestMetaCleanup();

        expect(buildMetaCleanupPlan).not.toHaveBeenCalled();
    });

    it('calls buildMetaCleanupPlan with correct args in per-realm mode', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })    // repositoryPrompt
            .mockResolvedValueOnce({ deletionLevel: 'P3' })     // deletionLevelPrompt
            .mockResolvedValueOnce({ deletionSource: 'per-realm' }) // deletionSourcePrompt
            .mockResolvedValueOnce({ confirm: false });          // confirmExecutionPrompt

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerTestMetaCleanup();

        expect(buildRealmPreferenceMapFromFiles).toHaveBeenCalledWith(
            ['EU05'], 'development', { maxTier: 'P3' }
        );
        expect(buildMetaCleanupPlan).toHaveBeenCalled();
        expect(getRealmsByInstanceType).toHaveBeenCalledWith('development');
    });

    it('calls buildCrossRealmPreferenceMap when cross-realm source selected', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P1' })
            .mockResolvedValueOnce({ deletionSource: 'cross-realm' })
            .mockResolvedValueOnce({ confirm: false });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerTestMetaCleanup();

        expect(buildCrossRealmPreferenceMap).toHaveBeenCalledWith(
            ['EU05'], 'development', { maxTier: 'P1' }
        );
    });

    it('exits early when no preferences to process', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P1' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        buildRealmPreferenceMapFromFiles.mockReturnValue({
            realmPreferenceMap: new Map(),
            blockedByBlacklist: [],
            skippedByWhitelist: [],
            missingRealms: []
        });

        await triggerTestMetaCleanup();

        expect(buildMetaCleanupPlan).not.toHaveBeenCalled();
    });

    it('skips execution when no plan actions', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        buildMetaCleanupPlan.mockReturnValue({ actions: [], skipped: [] });

        await triggerTestMetaCleanup();

        expect(executeMetaCleanupPlan).not.toHaveBeenCalled();
    });

    it('aborts when user declines confirmation', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ confirm: false });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerTestMetaCleanup();

        expect(executeMetaCleanupPlan).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('Aborted')
        );
    });

    it('executes cleanup plan and removes pref values when user confirms', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ confirm: true });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerTestMetaCleanup();

        expect(executeMetaCleanupPlan).toHaveBeenCalled();
        expect(removePreferenceValuesFromSites).toHaveBeenCalled();
    });

    it('runs cross-realm scan when cross-realm mode is active', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P1' })
            .mockResolvedValueOnce({ deletionSource: 'cross-realm' })
            .mockResolvedValueOnce({ confirm: true });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerTestMetaCleanup();

        expect(scanSitesForRemainingPreferences).toHaveBeenCalled();
        expect(formatSitesScanResults).toHaveBeenCalled();
    });

    it('does not run cross-realm scan in per-realm mode', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P1' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ confirm: true });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerTestMetaCleanup();

        expect(scanSitesForRemainingPreferences).not.toHaveBeenCalled();
    });

    it('uses instanceTypeOverride when provided', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P1' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ confirm: false });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: 'staging'
        });

        await triggerTestMetaCleanup();

        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('staging')
        );
    });

    it('logs blacklisted and missing realm counts', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        buildRealmPreferenceMapFromFiles.mockReturnValue({
            realmPreferenceMap: new Map([['EU05', ['c_pref1']]]),
            blockedByBlacklist: ['c_blocked'],
            skippedByWhitelist: ['c_skipped'],
            missingRealms: ['APAC']
        });

        buildMetaCleanupPlan.mockReturnValue({ actions: [], skipped: [] });

        await triggerTestMetaCleanup();

        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('Blocked by blacklist: 1')
        );
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('Skipped (not whitelisted): 1')
        );
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('APAC')
        );
    });
});

// ============================================================================
// metaCleanup — full git workflow
// ============================================================================

describe('metaCleanup', () => {
    it('exits early when no sibling repositories found', async () => {
        getSiblingRepositories.mockResolvedValue([]);

        await triggerMetaCleanup();

        expect(getCurrentBranch).not.toHaveBeenCalled();
    });

    it('shows repo status and checks for uncommitted changes', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValueOnce(true);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ proceed: false }); // abort at uncommitted warning

        await triggerMetaCleanup();

        expect(getCurrentBranch).toHaveBeenCalled();
    });

    it('aborts when user declines uncommitted changes warning', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(true);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ proceed: false });

        await triggerMetaCleanup();

        expect(createAndCheckoutBranch).not.toHaveBeenCalled();
    });

    it('creates branch and executes full workflow on happy path', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })        // repositoryPrompt
            .mockResolvedValueOnce({ deletionLevel: 'P3' })         // deletionLevelPrompt
            .mockResolvedValueOnce({ deletionSource: 'per-realm' }) // deletionSourcePrompt
            .mockResolvedValueOnce({ branchStrategy: 'new' })       // branchStrategyPrompt
            .mockResolvedValueOnce({ baseBranch: 'main' })          // baseBranchPrompt
            .mockResolvedValueOnce({ branchName: 'cleanup/test' })  // branchNamePrompt
            .mockResolvedValueOnce({ confirm: true })               // confirmExecutionPrompt
            .mockResolvedValueOnce({ consolidate: false })          // consolidateMetaPrompt
            .mockResolvedValueOnce({ confirmCommit: true })         // confirmCommitPrompt
            .mockResolvedValueOnce({ commitMsg: 'chore: cleanup' }); // commitMessagePrompt

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(createAndCheckoutBranch).toHaveBeenCalledWith(
            expect.any(String), 'cleanup/test', 'main'
        );
        expect(getRealmsByInstanceType).toHaveBeenCalledWith('development');
        expect(executeMetaCleanupPlan).toHaveBeenCalled();
        expect(stageAllChanges).toHaveBeenCalled();
        expect(commitChanges).toHaveBeenCalled();
    });

    it('aborts when branch creation fails', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);
        createAndCheckoutBranch.mockReturnValue(false);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P1' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ branchStrategy: 'new' })
            .mockResolvedValueOnce({ baseBranch: 'main' })
            .mockResolvedValueOnce({ branchName: 'test-branch' });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(executeMetaCleanupPlan).not.toHaveBeenCalled();
    });

    it('runs consolidation when user opts in', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ branchStrategy: 'new' })
            .mockResolvedValueOnce({ baseBranch: 'main' })
            .mockResolvedValueOnce({ branchName: 'cleanup/test' })
            .mockResolvedValueOnce({ confirm: true })
            .mockResolvedValueOnce({ consolidate: true })
            .mockResolvedValueOnce({ confirmCommit: true })
            .mockResolvedValueOnce({ commitMsg: 'chore: cleanup' });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(consolidateMetaFiles).toHaveBeenCalledWith({
            repoPath: expect.any(String),
            realmList: ['EU05'],
            instanceType: 'development'
        });
    });

    it('skips commit when no files were changed', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);

        executeMetaCleanupPlan.mockReturnValue({
            filesModified: [],
            filesDeleted: [],
            filesCreated: []
        });

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ branchStrategy: 'new' })
            .mockResolvedValueOnce({ baseBranch: 'main' })
            .mockResolvedValueOnce({ branchName: 'cleanup/test' })
            .mockResolvedValueOnce({ confirm: true })
            .mockResolvedValueOnce({ consolidate: false });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(stageAllChanges).not.toHaveBeenCalled();
        expect(commitChanges).not.toHaveBeenCalled();
    });

    it('skips commit when user declines commit prompt', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ branchStrategy: 'new' })
            .mockResolvedValueOnce({ baseBranch: 'main' })
            .mockResolvedValueOnce({ branchName: 'cleanup/test' })
            .mockResolvedValueOnce({ confirm: true })
            .mockResolvedValueOnce({ consolidate: false })
            .mockResolvedValueOnce({ confirmCommit: false });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(stageAllChanges).not.toHaveBeenCalled();
    });

    it('calls generateCleanupBranchName with tier and instance type', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ branchStrategy: 'new' })
            .mockResolvedValueOnce({ baseBranch: 'main' })
            .mockResolvedValueOnce({ branchName: 'cleanup/test' })
            .mockResolvedValueOnce({ confirm: false });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(generateCleanupBranchName).toHaveBeenCalledWith('P3-development');
    });

    it('calls stripCustomPrefix for commit body attribute list', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ branchStrategy: 'new' })
            .mockResolvedValueOnce({ baseBranch: 'main' })
            .mockResolvedValueOnce({ branchName: 'cleanup/test' })
            .mockResolvedValueOnce({ confirm: true })
            .mockResolvedValueOnce({ consolidate: false })
            .mockResolvedValueOnce({ confirmCommit: true })
            .mockResolvedValueOnce({ commitMsg: 'chore: cleanup' });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(stripCustomPrefix).toHaveBeenCalled();
        expect(commitChanges).toHaveBeenCalledWith(
            expect.any(String),
            'chore: cleanup',
            expect.stringContaining('Removed attributes')
        );
    });

    it('exits early when no preferences to process after loading', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);

        buildRealmPreferenceMapFromFiles.mockReturnValue({
            realmPreferenceMap: new Map(),
            blockedByBlacklist: [],
            skippedByWhitelist: [],
            missingRealms: []
        });

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P1' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(buildMetaCleanupPlan).not.toHaveBeenCalled();
    });

    it('handles consolidation with partial failures', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        hasUncommittedChanges.mockReturnValue(false);

        consolidateMetaFiles.mockResolvedValue({
            successCount: 1, failCount: 1, results: []
        });

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ branchStrategy: 'new' })
            .mockResolvedValueOnce({ baseBranch: 'main' })
            .mockResolvedValueOnce({ branchName: 'cleanup/test' })
            .mockResolvedValueOnce({ confirm: true })
            .mockResolvedValueOnce({ consolidate: true })
            .mockResolvedValueOnce({ continueAnyway: true })
            .mockResolvedValueOnce({ confirmCommit: true })
            .mockResolvedValueOnce({ commitMsg: 'chore: cleanup' });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(commitChanges).toHaveBeenCalled();
    });

    it('aborts after consolidation when all consolidations fail', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);

        consolidateMetaFiles.mockResolvedValue({
            successCount: 0, failCount: 2, results: []
        });

        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ deletionLevel: 'P3' })
            .mockResolvedValueOnce({ deletionSource: 'per-realm' })
            .mockResolvedValueOnce({ branchStrategy: 'new' })
            .mockResolvedValueOnce({ baseBranch: 'main' })
            .mockResolvedValueOnce({ branchName: 'cleanup/test' })
            .mockResolvedValueOnce({ confirm: true })
            .mockResolvedValueOnce({ consolidate: true })
            .mockResolvedValueOnce({ confirmCommit: false });

        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'], instanceTypeOverride: null
        });

        await triggerMetaCleanup();

        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('All consolidations failed')
        );
    });
});
