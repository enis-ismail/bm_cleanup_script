import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock all dependencies that preferences.js imports
vi.mock('../../../src/io/util.js', () => ({
    findAllMatrixFiles: vi.fn(),
    getSiblingRepositories: vi.fn(() => [])
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getAvailableRealms: vi.fn(() => []),
    getInstanceType: vi.fn(),
    getRealmsByInstanceType: vi.fn(() => []),
    getSandboxConfig: vi.fn()
}));

vi.mock('../../../src/helpers/timer.js', () => ({
    startTimer: vi.fn(() => ({ stop: vi.fn(() => '1.0s') }))
}));

vi.mock('../../../src/scripts/loggingScript/progressDisplay.js', () => ({
    RealmProgressDisplay: vi.fn()
}));

vi.mock('../../../src/commands/prompts/index.js', () => ({
    instanceTypePrompt: vi.fn(),
    realmPrompt: vi.fn(),
    objectTypePrompt: vi.fn(),
    resolveRealmScopeSelection: vi.fn(),
    deletionLevelPrompt: vi.fn(),
    deletionSourcePrompt: vi.fn(),
    confirmExecutionPrompt: vi.fn(),
    repositoryPrompt: vi.fn(),
    promptBackupCachePreference: vi.fn()
}));

vi.mock('../../../src/config/constants.js', () => ({
    LOG_PREFIX: { SUCCESS: '[OK]', WARNING: '[WARN]', ERROR: '[ERR]', INFO: '[INFO]' },
    DIRECTORIES: { RESULTS: 'results', BACKUP: 'backup' },
    IDENTIFIERS: { ALL_REALMS: 'ALL_REALMS' },
    FILE_PATTERNS: {},
    ANALYSIS_STEPS: {}
}));

vi.mock('../../../src/scripts/loggingScript/log.js', () => ({
    logNoMatrixFiles: vi.fn(),
    logMatrixFilesFound: vi.fn(),
    logSummaryHeader: vi.fn(),
    logRealmSummary: vi.fn(),
    logSummaryFooter: vi.fn(),
    logSectionTitle: vi.fn(),
    logRuntime: vi.fn(),
    logDeletionSummary: vi.fn(),
    logRestoreSummary: vi.fn(),
    logBackupClassification: vi.fn()
}));

vi.mock('../../../src/helpers/analyzer.js', () => ({
    processPreferenceMatrixFiles: vi.fn(),
    executePreferenceSummarization: vi.fn(),
    executePreferenceSummarizationFromMetadata: vi.fn()
}));

vi.mock('../../../src/io/csv.js', () => ({
    exportSitesCartridgesToCSV: vi.fn()
}));

vi.mock('../../../src/io/codeScanner.js', () => ({
    findAllActivePreferencesUsage: vi.fn(),
    getActivePreferencesFromMatrices: vi.fn()
}));

vi.mock('../../../src/commands/preferences/helpers/preferenceRemoval.js', () => ({
    generateDeletionSummary: vi.fn(),
    buildRealmPreferenceMapFromFiles: vi.fn(),
    buildCrossRealmPreferenceMap: vi.fn(),
    openRealmDeletionFilesInEditor: vi.fn(),
    openCrossRealmFileInEditor: vi.fn()
}));

vi.mock('../../../src/io/backupUtils.js', () => ({
    loadBackupFile: vi.fn()
}));

vi.mock('../../../src/helpers/backupJob.js', () => ({
    refreshMetadataBackupForRealm: vi.fn()
}));

vi.mock('../../../src/commands/preferences/helpers/realmHelpers.js', () => ({
    validateRealmsSelection: vi.fn(() => true)
}));

vi.mock('../../../src/commands/preferences/helpers/backupHelpers.js', () => ({
    findLatestBackupFile: vi.fn(),
    validateAndCorrectBackup: vi.fn(),
    createBackupsForRealms: vi.fn()
}));

vi.mock('../../../src/commands/preferences/helpers/deleteHelpers.js', () => ({
    runAnalyzePreferencesSubprocess: vi.fn(),
    deletePreferencesForRealms: vi.fn(),
    classifyRealmBackupStatus: vi.fn()
}));

vi.mock('../../../src/commands/preferences/helpers/restoreHelper.js', () => ({
    restorePreferencesForRealm: vi.fn()
}));

vi.mock('inquirer', () => ({
    default: { prompt: vi.fn() }
}));

import { registerPreferenceCommands } from '../../../src/commands/preferences/preferences.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// registerPreferenceCommands
// ============================================================================

describe('registerPreferenceCommands', () => {
    it('registers exactly 4 commands', () => {
        const program = new Command();
        program.exitOverride();
        registerPreferenceCommands(program);
        expect(program.commands).toHaveLength(4);
    });

    it('registers analyze-preferences command', () => {
        const program = new Command();
        registerPreferenceCommands(program);
        const cmd = program.commands.find(c => c.name() === 'analyze-preferences');
        expect(cmd).toBeDefined();
        expect(cmd.description()).toContain('analysis');
    });

    it('registers remove-preferences command with dry-run option', () => {
        const program = new Command();
        registerPreferenceCommands(program);
        const cmd = program.commands.find(c => c.name() === 'remove-preferences');
        expect(cmd).toBeDefined();
        const optionNames = cmd.options.map(o => o.long);
        expect(optionNames).toContain('--dry-run');
    });

    it('registers restore-preferences command', () => {
        const program = new Command();
        registerPreferenceCommands(program);
        const cmd = program.commands.find(c => c.name() === 'restore-preferences');
        expect(cmd).toBeDefined();
        expect(cmd.description()).toContain('Restore');
    });

    it('registers backup-site-preferences command', () => {
        const program = new Command();
        registerPreferenceCommands(program);
        const cmd = program.commands.find(c => c.name() === 'backup-site-preferences');
        expect(cmd).toBeDefined();
        expect(cmd.description()).toContain('backup');
    });

    it('all commands have descriptions', () => {
        const program = new Command();
        registerPreferenceCommands(program);
        for (const cmd of program.commands) {
            expect(cmd.description()).toBeTruthy();
        }
    });
});
