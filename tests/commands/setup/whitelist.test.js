import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/commands/setup/helpers/whitelistHelper.js', () => ({
    addToWhitelist: vi.fn(),
    removeFromWhitelist: vi.fn(),
    listWhitelist: vi.fn()
}));

vi.mock('../../../src/commands/setup/helpers/listCommands.js', () => ({
    createListCommands: vi.fn(() => vi.fn())
}));

import { registerWhitelistCommands } from '../../../src/commands/setup/actions/whitelist.js';
import { createListCommands } from '../../../src/commands/setup/helpers/listCommands.js';

// ============================================================================
// Tests
// ============================================================================

describe('whitelist command registration', () => {
    it('calls createListCommands with whitelist configuration', () => {
        expect(createListCommands).toHaveBeenCalledWith(
            expect.objectContaining({
                listName: 'whitelist',
                helpers: expect.objectContaining({
                    addToList: expect.any(Function),
                    removeFromList: expect.any(Function),
                    listEntries: expect.any(Function)
                }),
                descriptions: expect.objectContaining({
                    add: expect.stringContaining('whitelist'),
                    remove: expect.stringContaining('whitelist'),
                    list: expect.stringContaining('whitelist')
                }),
                emptyMessage: expect.stringContaining('Whitelist is empty'),
                headerTitle: 'PREFERENCE WHITELIST'
            })
        );
    });

    it('exports registerWhitelistCommands as a function', () => {
        expect(typeof registerWhitelistCommands).toBe('function');
    });

    it('includes wildcard and regex examples', () => {
        expect(createListCommands).toHaveBeenCalledWith(
            expect.objectContaining({
                wildcardExample: 'c_test*',
                regexExample: 'c_(test|pilot).*'
            })
        );
    });

    it('passes correct empty hint', () => {
        expect(createListCommands).toHaveBeenCalledWith(
            expect.objectContaining({
                emptyHint: expect.stringContaining('add-to-whitelist')
            })
        );
    });
});
