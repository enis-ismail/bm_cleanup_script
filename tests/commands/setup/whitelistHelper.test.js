import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

const mockHelper = vi.hoisted(() => ({
    loadList: vi.fn(() => ({ description: '', whitelist: [] })),
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
    loadWhitelist,
    saveWhitelist,
    isWhitelisted,
    filterWhitelisted,
    addToWhitelist,
    removeFromWhitelist,
    listWhitelist
} from '../../../src/commands/setup/helpers/whitelistHelper.js';
import { createListHelper } from '../../../src/commands/setup/helpers/blackAndWhiteListHelper.js';

// ============================================================================
// Tests
// ============================================================================

describe('whitelistHelper', () => {
    it('calls createListHelper with whitelist config', () => {
        expect(createListHelper).toHaveBeenCalledWith({
            listType: 'whitelist',
            configFileName: 'preference_whitelist.json',
            filterMode: 'include'
        });
    });

    it('exports loadWhitelist bound to helper.loadList', () => {
        expect(loadWhitelist).toBe(mockHelper.loadList);
    });

    it('exports saveWhitelist bound to helper.saveList', () => {
        expect(saveWhitelist).toBe(mockHelper.saveList);
    });

    it('exports isWhitelisted bound to helper.isInList', () => {
        expect(isWhitelisted).toBe(mockHelper.isInList);
    });

    it('exports filterWhitelisted bound to helper.filterByList', () => {
        expect(filterWhitelisted).toBe(mockHelper.filterByList);
    });

    it('exports addToWhitelist bound to helper.addToList', () => {
        expect(addToWhitelist).toBe(mockHelper.addToList);
    });

    it('exports removeFromWhitelist bound to helper.removeFromList', () => {
        expect(removeFromWhitelist).toBe(mockHelper.removeFromList);
    });

    it('exports listWhitelist bound to helper.listEntries', () => {
        expect(listWhitelist).toBe(mockHelper.listEntries);
    });

    it('delegates loadWhitelist calls to the factory helper', () => {
        loadWhitelist();
        expect(mockHelper.loadList).toHaveBeenCalled();
    });

    it('delegates isWhitelisted calls with arguments', () => {
        isWhitelisted('c_testPref', [{ id: 'c_testPref', type: 'exact' }], 'EU05');
        expect(mockHelper.isInList).toHaveBeenCalledWith(
            'c_testPref',
            [{ id: 'c_testPref', type: 'exact' }],
            'EU05'
        );
    });

    it('delegates filterWhitelisted calls with arguments', () => {
        filterWhitelisted(['c_a', 'c_b'], null, 'APAC');
        expect(mockHelper.filterByList).toHaveBeenCalledWith(
            ['c_a', 'c_b'],
            null,
            'APAC'
        );
    });

    it('delegates addToWhitelist with entry object', () => {
        const entry = { pattern: 'c_test*', type: 'wildcard', reason: 'test' };
        addToWhitelist(entry);
        expect(mockHelper.addToList).toHaveBeenCalledWith(entry);
    });

    it('delegates removeFromWhitelist with value', () => {
        removeFromWhitelist('c_test*');
        expect(mockHelper.removeFromList).toHaveBeenCalledWith('c_test*');
    });
});
