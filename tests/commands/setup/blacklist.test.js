import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/commands/setup/helpers/blacklistHelper.js', () => ({
    addToBlacklist: vi.fn(),
    removeFromBlacklist: vi.fn(),
    listBlacklist: vi.fn()
}));

vi.mock('../../../src/commands/setup/helpers/listCommands.js', () => ({
    createListCommands: vi.fn(() => vi.fn())
}));

import { registerBlacklistCommands } from '../../../src/commands/setup/blacklist.js';
import { createListCommands } from '../../../src/commands/setup/helpers/listCommands.js';

// ============================================================================
// Tests
// ============================================================================

describe('blacklist command registration', () => {
    it('calls createListCommands with blacklist configuration', () => {
        expect(createListCommands).toHaveBeenCalledWith(
            expect.objectContaining({
                listName: 'blacklist',
                helpers: expect.objectContaining({
                    addToList: expect.any(Function),
                    removeFromList: expect.any(Function),
                    listEntries: expect.any(Function)
                }),
                descriptions: expect.objectContaining({
                    add: expect.stringContaining('blacklist'),
                    remove: expect.stringContaining('blacklist'),
                    list: expect.stringContaining('blacklist')
                }),
                emptyMessage: expect.stringContaining('Blacklist is empty'),
                headerTitle: 'PREFERENCE BLACKLIST'
            })
        );
    });

    it('exports registerBlacklistCommands as a function', () => {
        expect(typeof registerBlacklistCommands).toBe('function');
    });

    it('includes wildcard and regex examples', () => {
        expect(createListCommands).toHaveBeenCalledWith(
            expect.objectContaining({
                wildcardExample: 'c_adyen*',
                regexExample: 'c_(adyen|klarna).*'
            })
        );
    });

    it('passes correct empty hint', () => {
        expect(createListCommands).toHaveBeenCalledWith(
            expect.objectContaining({
                emptyHint: expect.stringContaining('add-to-blacklist')
            })
        );
    });
});
