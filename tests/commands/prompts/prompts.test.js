import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/index.js', () => ({
    getAvailableRealms: vi.fn(() => ['EU05', 'APAC', 'GB', 'PNA']),
    getInstanceType: vi.fn((realm) => {
        const map = { EU05: 'development', APAC: 'development', GB: 'development', PNA: 'development' };
        return map[realm] || 'sandbox';
    }),
    getRealmsByInstanceType: vi.fn((type) => {
        if (type === 'development') return ['EU05', 'APAC', 'GB', 'PNA'];
        if (type === 'sandbox') return ['bcwr-080'];
        return [];
    })
}));

vi.mock('../../../src/config/constants.js', () => ({
    IDENTIFIERS: { SITE_PREFERENCES: 'SitePreferences' },
    LOG_PREFIX: { INFO: '[INFO]', WARNING: '[WARN]', ERROR: '[ERROR]' },
    BACKUP_CONFIG: { MAX_AGE_DAYS: 7 }
}));

vi.mock('../../../src/scripts/loggingScript/log.js', () => ({
    logSectionTitle: vi.fn()
}));

vi.mock('../../../src/io/backupUtils.js', () => ({
    checkBackupStatusForRealms: vi.fn()
}));

vi.mock('inquirer', () => ({
    default: { prompt: vi.fn() }
}));

import {
    realmPrompt,
    realmWithAllPrompt,
    addRealmPrompts,
    selectRealmToRemovePrompt,
    confirmRealmRemovalPrompt,
    instanceTypePrompt,
    realmByInstanceTypePrompt,
    selectRealmsForInstancePrompt
} from '../../../src/commands/prompts/realmPrompts.js';

import {
    deletionSourcePrompt,
    deletionLevelPrompt,
    confirmPreferenceDeletionPrompt,
    runAnalyzePreferencesPrompt,
    confirmRestoreAfterDeletionPrompt,
    confirmProceedRestorePrompt,
    overwriteBackupsPrompt,
    refreshMetadataPrompt,
    applyBackupCorrectionsPrompt,
    preferenceIdPrompt,
    objectTypePrompt,
    scopePrompts,
    includeDefaultsPrompt,
    useExistingBackupPrompt,
    useExistingBackupsForAllRealmsPrompt,
    promptBackupCachePreference
} from '../../../src/commands/prompts/preferencePrompts.js';

import {
    realmScopePrompt,
    resolveRealmScopeSelection,
    realmsByInstanceTypePrompt,
    getRealmsForInstanceType,
    repositoryPrompt,
    repositoriesMultiSelectPrompt
} from '../../../src/commands/prompts/commonPrompts.js';

import { groupIdPrompt } from '../../../src/commands/prompts/debugPrompts.js';

import {
    confirmExecutionPrompt,
    uncommittedChangesPrompt,
    baseBranchPrompt,
    branchNamePrompt,
    consolidateMetaPrompt,
    consolidationFailurePrompt,
    confirmCommitPrompt,
    commitMessagePrompt
} from '../../../src/commands/prompts/metaPrompts.js';

import { getAvailableRealms, getInstanceType } from '../../../src/index.js';
import { checkBackupStatusForRealms } from '../../../src/io/backupUtils.js';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// realmPrompts.js
// ============================================================================

describe('realmPrompts', () => {
    describe('realmPrompt', () => {
        it('returns array with realm rawlist prompt', () => {
            const result = realmPrompt();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('realm');
            expect(result[0].type).toBe('rawlist');
            expect(result[0].choices).toEqual(['EU05', 'APAC', 'GB', 'PNA']);
        });
    });

    describe('realmWithAllPrompt', () => {
        it('includes "all realms" as first choice', () => {
            const result = realmWithAllPrompt();
            expect(result[0].choices[0]).toBe('all realms');
            expect(result[0].choices).toContain('EU05');
        });
    });

    describe('addRealmPrompts', () => {
        it('returns 6 prompts for realm config', () => {
            const result = addRealmPrompts();
            expect(result).toHaveLength(6);
            expect(result.map(p => p.name)).toEqual([
                'name', 'hostname', 'clientId', 'clientSecret',
                'siteTemplatesPath', 'instanceType'
            ]);
        });

        it('validates non-empty name', () => {
            const namePrompt = addRealmPrompts().find(p => p.name === 'name');
            expect(namePrompt.validate('')).not.toBe(true);
            expect(namePrompt.validate('test')).toBe(true);
        });
    });

    describe('selectRealmToRemovePrompt', () => {
        it('uses provided realms as choices', () => {
            const result = selectRealmToRemovePrompt(['A', 'B']);
            expect(result[0].choices).toEqual(['A', 'B']);
            expect(result[0].name).toBe('realmToRemove');
        });
    });

    describe('confirmRealmRemovalPrompt', () => {
        it('includes realm name in message', () => {
            const result = confirmRealmRemovalPrompt('EU05');
            expect(result[0].message).toContain('EU05');
            expect(result[0].default).toBe(false);
        });
    });

    describe('instanceTypePrompt', () => {
        it('uses provided default', () => {
            const result = instanceTypePrompt('staging');
            expect(result[0].default).toBe('staging');
            expect(result[0].choices).toContain('sandbox');
        });

        it('defaults to sandbox', () => {
            const result = instanceTypePrompt();
            expect(result[0].default).toBe('sandbox');
        });
    });

    describe('realmByInstanceTypePrompt', () => {
        it('returns prompt with realms for instance type', () => {
            const result = realmByInstanceTypePrompt('development');
            expect(result[0].name).toBe('realm');
            expect(result[0].choices).toEqual(['EU05', 'APAC', 'GB', 'PNA']);
        });
    });

    describe('selectRealmsForInstancePrompt', () => {
        it('returns checkbox prompt with all realms selected by default', () => {
            const result = selectRealmsForInstancePrompt('development');
            expect(result[0].type).toBe('checkbox');
            expect(result[0].default).toEqual(['EU05', 'APAC', 'GB', 'PNA']);
        });
    });
});

// ============================================================================
// preferencePrompts.js
// ============================================================================

describe('preferencePrompts', () => {
    describe('deletionSourcePrompt', () => {
        it('returns rawlist with per-realm and cross-realm choices', () => {
            const result = deletionSourcePrompt();
            const values = result[0].choices.map(c => c.value);
            expect(values).toContain('per-realm');
            expect(values).toContain('cross-realm');
        });
    });

    describe('deletionLevelPrompt', () => {
        it('returns P1 through P5 choices', () => {
            const result = deletionLevelPrompt();
            const values = result[0].choices.map(c => c.value);
            expect(values).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
        });
    });

    describe('confirmPreferenceDeletionPrompt', () => {
        it('includes count in message', () => {
            const result = confirmPreferenceDeletionPrompt(42);
            expect(result[0].message).toContain('42');
            expect(result[0].default).toBe(false);
        });

        it('uses dry-run wording when dryRun is true', () => {
            const result = confirmPreferenceDeletionPrompt(10, true);
            expect(result[0].message).toContain('dry-run');
            expect(result[0].default).toBe(true);
        });
    });

    describe('runAnalyzePreferencesPrompt', () => {
        it('includes instance type in message', () => {
            const result = runAnalyzePreferencesPrompt('development');
            expect(result[0].message).toContain('development');
        });
    });

    describe('confirmRestoreAfterDeletionPrompt', () => {
        it('defaults to false', () => {
            const result = confirmRestoreAfterDeletionPrompt();
            expect(result[0].name).toBe('restore');
            expect(result[0].default).toBe(false);
        });
    });

    describe('confirmProceedRestorePrompt', () => {
        it('returns confirm prompt', () => {
            const result = confirmProceedRestorePrompt();
            expect(result[0].name).toBe('proceed');
        });
    });

    describe('overwriteBackupsPrompt', () => {
        it('includes count in message', () => {
            const result = overwriteBackupsPrompt(3);
            expect(result[0].message).toContain('3');
        });
    });

    describe('refreshMetadataPrompt', () => {
        it('returns confirm prompt defaulting to false', () => {
            const result = refreshMetadataPrompt();
            expect(result[0].name).toBe('refreshMetadata');
            expect(result[0].default).toBe(false);
        });
    });

    describe('applyBackupCorrectionsPrompt', () => {
        it('defaults to true', () => {
            const result = applyBackupCorrectionsPrompt();
            expect(result[0].default).toBe(true);
        });
    });

    describe('preferenceIdPrompt', () => {
        it('validates non-empty input', () => {
            const prompt = preferenceIdPrompt()[0];
            expect(prompt.validate('')).not.toBe(true);
            expect(prompt.validate('c_test')).toBe(true);
        });
    });

    describe('objectTypePrompt', () => {
        it('defaults to SitePreferences', () => {
            const result = objectTypePrompt();
            expect(result[0].default).toBe('SitePreferences');
        });
    });

    describe('scopePrompts', () => {
        it('returns scope and conditional siteId prompts', () => {
            const result = scopePrompts();
            expect(result).toHaveLength(2);

            const siteIdPrompt = result[1];
            expect(siteIdPrompt.when({ scope: 'single' })).toBe(true);
            expect(siteIdPrompt.when({ scope: 'all' })).toBe(false);
        });
    });

    describe('includeDefaultsPrompt', () => {
        it('defaults to true', () => {
            const result = includeDefaultsPrompt();
            expect(result[0].default).toBe(true);
        });
    });

    describe('useExistingBackupPrompt', () => {
        it('includes age in message — singular', () => {
            const result = useExistingBackupPrompt(1);
            expect(result[0].message).toContain('1 day old');
        });

        it('includes age in message — plural', () => {
            const result = useExistingBackupPrompt(3);
            expect(result[0].message).toContain('3 days old');
        });
    });

    describe('useExistingBackupsForAllRealmsPrompt', () => {
        it('includes available count in message', () => {
            const result = useExistingBackupsForAllRealmsPrompt({
                availableCount: 4,
                totalCount: 5
            });
            expect(result[0].message).toContain('4');
        });
    });

    describe('promptBackupCachePreference', () => {
        it('returns false when no valid backups exist', async () => {
            checkBackupStatusForRealms.mockResolvedValue([
                { realm: 'EU05', exists: false }
            ]);

            const result = await promptBackupCachePreference(['EU05'], 'SitePreferences');

            expect(result).toBe(false);
        });
    });
});

// ============================================================================
// commonPrompts.js
// ============================================================================

describe('commonPrompts', () => {
    describe('realmScopePrompt', () => {
        it('returns rawlist with 3 scope options', () => {
            const result = realmScopePrompt();
            expect(result[0].choices).toHaveLength(3);
            expect(result[0].default).toBe('All realms');
        });
    });

    describe('resolveRealmScopeSelection', () => {
        it('returns all realms when "All realms" is selected', async () => {
            const mockFn = vi.fn().mockResolvedValue({ realmScope: 'All realms' });

            const result = await resolveRealmScopeSelection(mockFn);

            expect(result.realmList).toEqual(['EU05', 'APAC', 'GB', 'PNA']);
            expect(result.instanceTypeOverride).toBeNull();
        });

        it('returns single realm when "Single realm" is selected', async () => {
            const mockFn = vi.fn()
                .mockResolvedValueOnce({ realmScope: 'Single realm' })
                .mockResolvedValueOnce({ realm: 'EU05' });

            const result = await resolveRealmScopeSelection(mockFn);

            expect(result.realmList).toEqual(['EU05']);
            expect(result.instanceTypeOverride).toBe('development');
        });

        it('returns realms for instance type when that option selected', async () => {
            const mockFn = vi.fn()
                .mockResolvedValueOnce({ realmScope: 'All realms of an instance type' })
                .mockResolvedValueOnce({ instanceType: 'development' });

            const result = await resolveRealmScopeSelection(mockFn);

            expect(result.realmList).toEqual(['EU05', 'APAC', 'GB', 'PNA']);
            expect(result.instanceTypeOverride).toBe('development');
        });
    });

    describe('realmsByInstanceTypePrompt', () => {
        it('returns rawlist prompt for instance type', () => {
            const result = realmsByInstanceTypePrompt();
            expect(result[0].name).toBe('instanceType');
        });
    });

    describe('getRealmsForInstanceType', () => {
        it('returns realms for valid instance type', () => {
            const result = getRealmsForInstanceType('development');
            expect(result).toEqual(['EU05', 'APAC', 'GB', 'PNA']);
        });

        it('returns null when no realms found', () => {
            const result = getRealmsForInstanceType('production');
            expect(result).toBeNull();
        });
    });

    describe('repositoryPrompt', () => {
        it('returns rawlist with siblings as choices', async () => {
            const result = await repositoryPrompt(['repo-a', 'repo-b']);
            expect(result[0].name).toBe('repository');
            expect(result[0].choices).toEqual(['repo-a', 'repo-b']);
        });
    });

    describe('repositoriesMultiSelectPrompt', () => {
        it('returns checkbox prompt with validation', async () => {
            const result = await repositoriesMultiSelectPrompt(['repo-a']);
            expect(result[0].type).toBe('checkbox');
            expect(result[0].validate([])).toBe('Select at least one repository');
            expect(result[0].validate(['repo-a'])).toBe(true);
        });
    });
});

// ============================================================================
// debugPrompts.js
// ============================================================================

describe('debugPrompts', () => {
    describe('groupIdPrompt', () => {
        it('returns input prompt with validation', () => {
            const result = groupIdPrompt();
            expect(result[0].name).toBe('groupId');
            expect(result[0].validate('')).not.toBe(true);
            expect(result[0].validate('test-group')).toBe(true);
        });
    });
});

// ============================================================================
// metaPrompts.js
// ============================================================================

describe('metaPrompts', () => {
    describe('confirmExecutionPrompt', () => {
        it('uses dry-run wording when dryRun is true', () => {
            const result = confirmExecutionPrompt({ actionCount: 5, dryRun: true });
            expect(result[0].message).toContain('dry-run');
            expect(result[0].message).toContain('5');
            expect(result[0].default).toBe(true);
        });

        it('uses live wording with repo name', () => {
            const result = confirmExecutionPrompt({
                actionCount: 3,
                dryRun: false,
                repoName: 'my-repo'
            });
            expect(result[0].message).toContain('my-repo');
            expect(result[0].default).toBe(false);
        });
    });

    describe('uncommittedChangesPrompt', () => {
        it('defaults to false', () => {
            const result = uncommittedChangesPrompt();
            expect(result[0].default).toBe(false);
        });
    });

    describe('baseBranchPrompt', () => {
        it('uses current branch as default', () => {
            const result = baseBranchPrompt(['main', 'develop'], 'develop');
            expect(result[0].default).toBe('develop');
            expect(result[0].choices).toEqual(['main', 'develop']);
        });
    });

    describe('branchNamePrompt', () => {
        it('validates empty input', () => {
            const result = branchNamePrompt('cleanup/test', ['main']);
            expect(result[0].validate('')).not.toBe(true);
        });

        it('rejects spaces in branch name', () => {
            const result = branchNamePrompt('cleanup/test', []);
            expect(result[0].validate('has spaces')).toBe('Branch name cannot contain spaces');
        });

        it('rejects existing branch name', () => {
            const result = branchNamePrompt('cleanup/test', ['main', 'develop']);
            expect(result[0].validate('main')).toBe('Branch already exists');
        });

        it('accepts valid new branch name', () => {
            const result = branchNamePrompt('cleanup/test', ['main']);
            expect(result[0].validate('cleanup/new')).toBe(true);
        });
    });

    describe('consolidateMetaPrompt', () => {
        it('returns confirm prompt defaulting to false', () => {
            const result = consolidateMetaPrompt();
            expect(result[0].default).toBe(false);
        });
    });

    describe('consolidationFailurePrompt', () => {
        it('includes fail count in message', () => {
            const result = consolidationFailurePrompt(2);
            expect(result[0].message).toContain('2');
        });
    });

    describe('confirmCommitPrompt', () => {
        it('includes file count in message', () => {
            const result = confirmCommitPrompt(10);
            expect(result[0].message).toContain('10');
        });
    });

    describe('commitMessagePrompt', () => {
        it('uses suggested message as default', () => {
            const result = commitMessagePrompt('chore: cleanup');
            expect(result[0].default).toBe('chore: cleanup');
        });
    });
});

// ============================================================================
// index.js re-exports
// ============================================================================

describe('prompts/index.js re-exports', () => {
    it('re-exports all expected prompts', async () => {
        const indexModule = await import('../../../src/commands/prompts/index.js');

        // realmPrompts
        expect(indexModule.realmPrompt).toBeDefined();
        expect(indexModule.instanceTypePrompt).toBeDefined();
        expect(indexModule.selectRealmsForInstancePrompt).toBeDefined();

        // preferencePrompts
        expect(indexModule.deletionLevelPrompt).toBeDefined();
        expect(indexModule.confirmPreferenceDeletionPrompt).toBeDefined();
        expect(indexModule.preferenceIdPrompt).toBeDefined();

        // commonPrompts
        expect(indexModule.resolveRealmScopeSelection).toBeDefined();
        expect(indexModule.repositoryPrompt).toBeDefined();

        // debugPrompts
        expect(indexModule.groupIdPrompt).toBeDefined();

        // metaPrompts
        expect(indexModule.confirmExecutionPrompt).toBeDefined();
        expect(indexModule.branchNamePrompt).toBeDefined();
    });
});
