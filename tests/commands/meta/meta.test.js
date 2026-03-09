import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../../src/helpers/timer.js', () => ({
    startTimer: vi.fn(() => ({ stop: vi.fn(() => '1.2s') }))
}));

vi.mock('../../../src/io/util.js', () => ({
    getSiblingRepositories: vi.fn(() => [])
}));

vi.mock('../../../src/commands/prompts/index.js', () => ({
    repositoryPrompt: vi.fn(),
    resolveRealmScopeSelection: vi.fn(),
    deletionLevelPrompt: vi.fn(),
    deletionSourcePrompt: vi.fn(),
    confirmExecutionPrompt: vi.fn(),
    uncommittedChangesPrompt: vi.fn(),
    baseBranchPrompt: vi.fn(),
    branchNamePrompt: vi.fn(),
    consolidateMetaPrompt: vi.fn(),
    consolidationFailurePrompt: vi.fn(),
    confirmCommitPrompt: vi.fn(),
    commitMessagePrompt: vi.fn()
}));

vi.mock('../../../src/commands/meta/helpers/metaFileCleanup.js', () => ({
    buildMetaCleanupPlan: vi.fn(),
    executeMetaCleanupPlan: vi.fn(),
    formatCleanupPlan: vi.fn(() => ''),
    formatExecutionResults: vi.fn(() => ''),
    scanSitesForRemainingPreferences: vi.fn(),
    formatSitesScanResults: vi.fn(() => ''),
    removePreferenceValuesFromSites: vi.fn(() => ({
        totalRemoved: 0,
        filesModified: []
    })),
    formatPreferenceValueResults: vi.fn(() => ''),
    stripCustomPrefix: vi.fn(id => id.startsWith('c_') ? id.slice(2) : id)
}));

vi.mock('../../../src/commands/meta/helpers/metaConsolidation.js', () => ({
    consolidateMetaFiles: vi.fn(),
    formatConsolidationResults: vi.fn(() => '')
}));

vi.mock('../../../src/commands/preferences/helpers/preferenceRemoval.js', () => ({
    buildRealmPreferenceMapFromFiles: vi.fn(),
    buildCrossRealmPreferenceMap: vi.fn()
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getInstanceType: vi.fn(() => 'development'),
    getAvailableRealms: vi.fn(() => ['EU05', 'APAC'])
}));

vi.mock('../../../src/config/constants.js', () => ({
    TIER_DESCRIPTIONS: { P1: 'Safest', P3: 'Moderate' }
}));

vi.mock('../../../src/commands/meta/helpers/gitHelper.js', () => ({
    getCurrentBranch: vi.fn(),
    listBranches: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    getStatusSummary: vi.fn(),
    createAndCheckoutBranch: vi.fn(),
    stageAllChanges: vi.fn(),
    commitChanges: vi.fn(),
    getStagedDiffStat: vi.fn(),
    generateCleanupBranchName: vi.fn()
}));

vi.mock('inquirer', () => ({
    default: { prompt: vi.fn() }
}));

import { registerMetaCommands } from '../../../src/commands/meta/meta.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
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
