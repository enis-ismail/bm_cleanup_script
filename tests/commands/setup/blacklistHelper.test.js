import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

const mockHelper = vi.hoisted(() => ({
    loadList: vi.fn(() => ({ description: '', blacklist: [] })),
    saveList: vi.fn(),
    isInList: vi.fn(() => false),
    filterByList: vi.fn(() => ({ allowed: [], blocked: [] })),
    addToList: vi.fn(() => true),
    removeFromList: vi.fn(() => true),
    listEntries: vi.fn(() => [])
}));

vi.mock('../../../src/commands/setup/helpers/blackAndWhiteListHelper.js', () => ({
    createListHelper: vi.fn(() => mockHelper)
}));

import {
    loadBlacklist,
    saveBlacklist,
    isBlacklisted,
    filterBlacklisted,
    addToBlacklist,
    removeFromBlacklist,
    listBlacklist
} from '../../../src/commands/setup/helpers/blacklistHelper.js';
import { createListHelper } from '../../../src/commands/setup/helpers/blackAndWhiteListHelper.js';

// ============================================================================
// Tests
// ============================================================================

describe('blacklistHelper', () => {
    it('calls createListHelper with blacklist config', () => {
        expect(createListHelper).toHaveBeenCalledWith({
            listType: 'blacklist',
            configFileName: 'preference_blacklist.json',
            filterMode: 'exclude'
        });
    });

    it('exports loadBlacklist bound to helper.loadList', () => {
        expect(loadBlacklist).toBe(mockHelper.loadList);
    });

    it('exports saveBlacklist bound to helper.saveList', () => {
        expect(saveBlacklist).toBe(mockHelper.saveList);
    });

    it('exports isBlacklisted bound to helper.isInList', () => {
        expect(isBlacklisted).toBe(mockHelper.isInList);
    });

    it('exports filterBlacklisted bound to helper.filterByList', () => {
        expect(filterBlacklisted).toBe(mockHelper.filterByList);
    });

    it('exports addToBlacklist bound to helper.addToList', () => {
        expect(addToBlacklist).toBe(mockHelper.addToList);
    });

    it('exports removeFromBlacklist bound to helper.removeFromList', () => {
        expect(removeFromBlacklist).toBe(mockHelper.removeFromList);
    });

    it('exports listBlacklist bound to helper.listEntries', () => {
        expect(listBlacklist).toBe(mockHelper.listEntries);
    });

    it('delegates loadBlacklist calls to the factory helper', () => {
        loadBlacklist();
        expect(mockHelper.loadList).toHaveBeenCalled();
    });

    it('delegates isBlacklisted calls with arguments', () => {
        isBlacklisted('c_testPref', [{ id: 'c_testPref', type: 'exact' }], 'EU05');
        expect(mockHelper.isInList).toHaveBeenCalledWith(
            'c_testPref',
            [{ id: 'c_testPref', type: 'exact' }],
            'EU05'
        );
    });

    it('delegates filterBlacklisted calls with arguments', () => {
        filterBlacklisted(['c_a', 'c_b'], null, 'APAC');
        expect(mockHelper.filterByList).toHaveBeenCalledWith(
            ['c_a', 'c_b'],
            null,
            'APAC'
        );
    });

    it('delegates addToBlacklist with entry object', () => {
        const entry = { id: 'c_foo', type: 'exact', reason: 'test' };
        addToBlacklist(entry);
        expect(mockHelper.addToList).toHaveBeenCalledWith(entry);
    });

    it('delegates removeFromBlacklist with value', () => {
        removeFromBlacklist('c_foo');
        expect(mockHelper.removeFromList).toHaveBeenCalledWith('c_foo');
    });
});
