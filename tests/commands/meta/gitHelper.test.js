import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
    execFileSync: vi.fn()
}));

vi.mock('../../../src/config/constants.js', () => ({
    LOG_PREFIX: {
        SUCCESS: '[OK]',
        WARNING: '[WARN]',
        ERROR: '[ERR]',
        INFO: '[INFO]'
    }
}));

vi.mock('../../../src/scripts/loggingScript/log.js', () => ({
    logError: vi.fn()
}));

import { execSync, execFileSync } from 'child_process';
import { logError } from '../../../src/scripts/loggingScript/log.js';

import {
    getCurrentBranch,
    listBranches,
    hasUncommittedChanges,
    getStatusSummary,
    createAndCheckoutBranch,
    stageAllChanges,
    commitChanges,
    getStagedDiffStat,
    generateCleanupBranchName
} from '../../../src/commands/meta/helpers/gitHelper.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// GIT QUERIES
// ============================================================================

describe('getCurrentBranch', () => {
    it('returns trimmed branch name', () => {
        execSync.mockReturnValue('  main\n');
        const result = getCurrentBranch('/repo');
        expect(result).toBe('main');
        expect(execSync).toHaveBeenCalledWith(
            'git rev-parse --abbrev-ref HEAD',
            { cwd: '/repo', encoding: 'utf-8' }
        );
    });
});

describe('listBranches', () => {
    it('returns sorted array of branch names', () => {
        execSync.mockReturnValue('develop\nmain\nfeature/x\n');
        const result = listBranches('/repo');
        expect(result).toEqual(['develop', 'feature/x', 'main']);
    });

    it('filters empty lines', () => {
        execSync.mockReturnValue('main\n\n\n');
        expect(listBranches('/repo')).toEqual(['main']);
    });
});

describe('hasUncommittedChanges', () => {
    it('returns true when status is non-empty', () => {
        execSync.mockReturnValue(' M file.js\n');
        expect(hasUncommittedChanges('/repo')).toBe(true);
    });

    it('returns false when status is empty', () => {
        execSync.mockReturnValue('');
        expect(hasUncommittedChanges('/repo')).toBe(false);
    });
});

describe('getStatusSummary', () => {
    it('returns trimmed status output', () => {
        execSync.mockReturnValue(' M file.js\n?? new.js\n');
        expect(getStatusSummary('/repo')).toBe('M file.js\n?? new.js');
    });
});

// ============================================================================
// GIT MUTATIONS
// ============================================================================

describe('createAndCheckoutBranch', () => {
    it('checks out base branch then creates new branch', () => {
        execSync.mockReturnValue('');
        const result = createAndCheckoutBranch('/repo', 'feature/test', 'main');
        expect(result).toBe(true);
        expect(execSync).toHaveBeenCalledTimes(2);
        expect(execSync).toHaveBeenCalledWith(
            'git checkout main',
            expect.objectContaining({ cwd: '/repo' })
        );
        expect(execSync).toHaveBeenCalledWith(
            'git checkout -b feature/test',
            expect.objectContaining({ cwd: '/repo' })
        );
    });

    it('returns false on error', () => {
        execSync.mockImplementation(() => { throw new Error('branch exists'); });
        const result = createAndCheckoutBranch('/repo', 'feature/test', 'main');
        expect(result).toBe(false);
        expect(logError).toHaveBeenCalledWith(expect.stringContaining('branch exists'));
    });
});

describe('stageAllChanges', () => {
    it('returns true on success', () => {
        execSync.mockReturnValue('');
        expect(stageAllChanges('/repo')).toBe(true);
        expect(execSync).toHaveBeenCalledWith(
            'git add -A',
            expect.objectContaining({ cwd: '/repo' })
        );
    });

    it('returns false on error', () => {
        execSync.mockImplementation(() => { throw new Error('fail'); });
        expect(stageAllChanges('/repo')).toBe(false);
        expect(logError).toHaveBeenCalled();
    });
});

describe('commitChanges', () => {
    it('commits with subject only', () => {
        execFileSync.mockReturnValue('');
        expect(commitChanges('/repo', 'test commit')).toBe(true);
        expect(execFileSync).toHaveBeenCalledWith(
            'git', ['commit', '-m', 'test commit'],
            expect.objectContaining({ cwd: '/repo' })
        );
    });

    it('commits with subject and body', () => {
        execFileSync.mockReturnValue('');
        commitChanges('/repo', 'subject', 'body text');
        expect(execFileSync).toHaveBeenCalledWith(
            'git', ['commit', '-m', 'subject', '-m', 'body text'],
            expect.objectContaining({ cwd: '/repo' })
        );
    });

    it('returns false on error', () => {
        execFileSync.mockImplementation(() => { throw new Error('nothing to commit'); });
        expect(commitChanges('/repo', 'test')).toBe(false);
        expect(logError).toHaveBeenCalled();
    });
});

describe('getStagedDiffStat', () => {
    it('returns trimmed diff stat', () => {
        execSync.mockReturnValue(' 2 files changed\n');
        expect(getStagedDiffStat('/repo')).toBe('2 files changed');
    });
});

// ============================================================================
// BRANCH NAME GENERATION
// ============================================================================

describe('generateCleanupBranchName', () => {
    it('generates branch name with date', () => {
        const name = generateCleanupBranchName();
        expect(name).toMatch(/^feature\/meta-cleanup-\d{4}-\d{2}-\d{2}$/);
    });

    it('appends suffix when provided', () => {
        const name = generateCleanupBranchName('P3-development');
        expect(name).toMatch(/^feature\/meta-cleanup-\d{4}-\d{2}-\d{2}-P3-development$/);
    });
});
