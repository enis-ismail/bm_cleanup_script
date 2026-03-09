import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/config/constants.js', () => ({
    LOG_PREFIX: { INFO: '[INFO]', WARNING: '[WARN]', ERROR: '[ERROR]' },
    IDENTIFIERS: { CUSTOM_ATTRIBUTE_PREFIX: 'c_' }
}));

vi.mock('../../../src/io/backupUtils.js', () => ({
    buildCreateSafeBody: vi.fn((attr) => ({ ...attr, _safe: true }))
}));

vi.mock('../../../src/api/api.js', () => ({
    updateAttributeDefinitionById: vi.fn(),
    assignAttributeToGroup: vi.fn(),
    getAttributeGroupById: vi.fn(),
    createOrUpdateAttributeGroup: vi.fn(),
    patchSitePreferencesGroup: vi.fn()
}));

import {
    restorePreference,
    restorePreferencesForRealm
} from '../../../src/commands/preferences/helpers/restoreHelper.js';

import {
    updateAttributeDefinitionById,
    assignAttributeToGroup,
    getAttributeGroupById,
    createOrUpdateAttributeGroup,
    patchSitePreferencesGroup
} from '../../../src/api/api.js';

// ============================================================================
// Test helpers
// ============================================================================

const makeBackup = (attrs = [], groups = [], siteValues = {}) => ({
    attributes: attrs,
    attribute_groups: groups,
    site_values: siteValues
});

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// restorePreference
// ============================================================================

describe('restorePreference', () => {
    it('returns false when preference not found in backup', async () => {
        const backup = makeBackup([]);

        const result = await restorePreference({
            preferenceId: 'c_missing',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(result).toBe(false);
    });

    it('restores attribute definition via PUT', async () => {
        const backup = makeBackup([
            { id: 'c_test', display_name: { default: 'Test' } }
        ]);
        updateAttributeDefinitionById.mockResolvedValue({ id: 'c_test' });

        const result = await restorePreference({
            preferenceId: 'c_test',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(result).toBe(true);
        expect(updateAttributeDefinitionById).toHaveBeenCalledWith(
            'SitePreferences', 'c_test', 'put',
            expect.objectContaining({ _safe: true }),
            'EU05', 'development'
        );
    });

    it('returns false when definition restore fails', async () => {
        const backup = makeBackup([{ id: 'c_fail' }]);
        updateAttributeDefinitionById.mockResolvedValue(null);

        const result = await restorePreference({
            preferenceId: 'c_fail',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(result).toBe(false);
    });

    it('restores group assignments when group exists', async () => {
        const backup = makeBackup(
            [{ id: 'c_test' }],
            [{ group_id: 'GroupA', attributes: ['c_test'] }]
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'c_test' });
        getAttributeGroupById.mockResolvedValue({ group_id: 'GroupA' });
        assignAttributeToGroup.mockResolvedValue(true);

        await restorePreference({
            preferenceId: 'c_test',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(getAttributeGroupById).toHaveBeenCalledWith(
            'SitePreferences', 'GroupA', 'EU05'
        );
        expect(assignAttributeToGroup).toHaveBeenCalledWith(
            'SitePreferences', 'GroupA', 'c_test', 'EU05', 'development'
        );
    });

    it('creates group when it does not exist', async () => {
        const backup = makeBackup(
            [{ id: 'c_test' }],
            [{ group_id: 'NewGroup', group_display_name: 'New Group', attributes: ['c_test'] }]
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'c_test' });
        getAttributeGroupById.mockResolvedValue(null);
        createOrUpdateAttributeGroup.mockResolvedValue(true);
        assignAttributeToGroup.mockResolvedValue(true);

        await restorePreference({
            preferenceId: 'c_test',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(createOrUpdateAttributeGroup).toHaveBeenCalledWith(
            'SitePreferences', 'NewGroup',
            { display_name: { default: 'New Group' } },
            'EU05', 'development'
        );
    });

    it('skips assignment when group creation fails', async () => {
        const backup = makeBackup(
            [{ id: 'c_test' }],
            [{ group_id: 'BadGroup', attributes: ['c_test'] }]
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'c_test' });
        getAttributeGroupById.mockResolvedValue(null);
        createOrUpdateAttributeGroup.mockResolvedValue(null);

        await restorePreference({
            preferenceId: 'c_test',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(assignAttributeToGroup).not.toHaveBeenCalled();
    });

    it('uses ensuredGroups cache to skip group re-check', async () => {
        const backup = makeBackup(
            [{ id: 'c_test' }],
            [{ group_id: 'CachedGroup', attributes: ['c_test'] }]
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'c_test' });
        assignAttributeToGroup.mockResolvedValue(true);

        const ensuredGroups = new Set(['CachedGroup']);

        await restorePreference({
            preferenceId: 'c_test',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05',
            ensuredGroups
        });

        // Should not check group existence since it's cached
        expect(getAttributeGroupById).not.toHaveBeenCalled();
        expect(createOrUpdateAttributeGroup).not.toHaveBeenCalled();
        expect(assignAttributeToGroup).toHaveBeenCalled();
    });

    it('adds to ensuredGroups cache after first check', async () => {
        const backup = makeBackup(
            [{ id: 'c_test' }],
            [{ group_id: 'NewGroup', attributes: ['c_test'] }]
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'c_test' });
        getAttributeGroupById.mockResolvedValue({ group_id: 'NewGroup' });
        assignAttributeToGroup.mockResolvedValue(true);

        const ensuredGroups = new Set();

        await restorePreference({
            preferenceId: 'c_test',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05',
            ensuredGroups
        });

        expect(ensuredGroups.has('NewGroup')).toBe(true);
    });

    it('restores site-specific values', async () => {
        const backup = makeBackup(
            [{ id: 'c_test' }],
            [],
            {
                c_test: {
                    groupId: 'GroupA',
                    siteValues: { SiteUS: 'valueA', SiteEU: 'valueB' }
                }
            }
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'c_test' });
        patchSitePreferencesGroup.mockResolvedValue(true);

        await restorePreference({
            preferenceId: 'c_test',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(patchSitePreferencesGroup).toHaveBeenCalledTimes(2);
        expect(patchSitePreferencesGroup).toHaveBeenCalledWith(
            'SiteUS', 'GroupA', 'development',
            { c_test: 'valueA' }, 'EU05'
        );
    });

    it('adds c_ prefix to attribute key if missing', async () => {
        const backup = makeBackup(
            [{ id: 'testPref' }],
            [],
            {
                testPref: {
                    groupId: 'GroupA',
                    siteValues: { SiteUS: 'val' }
                }
            }
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'testPref' });
        patchSitePreferencesGroup.mockResolvedValue(true);

        await restorePreference({
            preferenceId: 'testPref',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(patchSitePreferencesGroup).toHaveBeenCalledWith(
            'SiteUS', 'GroupA', 'development',
            { c_testPref: 'val' }, 'EU05'
        );
    });

    it('skips site value restore when no site values exist', async () => {
        const backup = makeBackup(
            [{ id: 'c_test' }],
            [],
            { c_test: { groupId: 'GroupA', siteValues: {} } }
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'c_test' });

        await restorePreference({
            preferenceId: 'c_test',
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(patchSitePreferencesGroup).not.toHaveBeenCalled();
    });
});

// ============================================================================
// restorePreferencesForRealm
// ============================================================================

describe('restorePreferencesForRealm', () => {
    it('restores multiple preferences and returns counts', async () => {
        updateAttributeDefinitionById
            .mockResolvedValueOnce({ id: 'c_a' })
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'c_c' });

        const backup = makeBackup([
            { id: 'c_a' },
            { id: 'c_b' },
            { id: 'c_c' }
        ]);

        const result = await restorePreferencesForRealm({
            preferenceIds: ['c_a', 'c_b', 'c_c'],
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(result.restored).toBe(2);
        expect(result.failed).toBe(1);
    });

    it('handles empty preference list', async () => {
        const backup = makeBackup([]);

        const result = await restorePreferencesForRealm({
            preferenceIds: [],
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        expect(result.restored).toBe(0);
        expect(result.failed).toBe(0);
    });

    it('shares ensuredGroups cache across preferences', async () => {
        const backup = makeBackup(
            [{ id: 'c_a' }, { id: 'c_b' }],
            [{ group_id: 'SharedGroup', attributes: ['c_a', 'c_b'] }]
        );
        updateAttributeDefinitionById.mockResolvedValue({ id: 'ok' });
        getAttributeGroupById.mockResolvedValue({ group_id: 'SharedGroup' });
        assignAttributeToGroup.mockResolvedValue(true);

        await restorePreferencesForRealm({
            preferenceIds: ['c_a', 'c_b'],
            backup,
            objectType: 'SitePreferences',
            instanceType: 'development',
            realm: 'EU05'
        });

        // First preference checks group, second skips because of ensuredGroups cache
        expect(getAttributeGroupById).toHaveBeenCalledTimes(1);
        expect(assignAttributeToGroup).toHaveBeenCalledTimes(2);
    });
});
