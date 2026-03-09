import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/config/constants.js', () => ({
    LOG_PREFIX: {
        INFO: '[INFO]',
        WARNING: '[WARN]',
        ERROR: '[ERROR]'
    }
}));

vi.mock('../../../src/index.js', () => ({
    getAvailableRealms: vi.fn(() => ['EU05', 'APAC', 'GB'])
}));

// Mock inquirer — we control the prompt responses
const mockPrompt = vi.fn();
vi.mock('inquirer', () => ({
    default: { prompt: (...args) => mockPrompt(...args) }
}));

import { createListCommands } from '../../../src/commands/setup/helpers/listCommands.js';

// ============================================================================
// Test helpers
// ============================================================================

let addToListMock;
let removeFromListMock;
let listEntriesMock;
let registerCommands;

function buildFactory(overrides = {}) {
    addToListMock = vi.fn(() => true);
    removeFromListMock = vi.fn(() => true);
    listEntriesMock = vi.fn(() => []);

    registerCommands = createListCommands({
        listName: 'testlist',
        helpers: {
            addToList: overrides.addToList || addToListMock,
            removeFromList: overrides.removeFromList || removeFromListMock,
            listEntries: overrides.listEntries || listEntriesMock
        },
        descriptions: {
            add: 'Add entry',
            remove: 'Remove entry',
            list: 'List entries'
        },
        emptyMessage: 'List is empty.',
        emptyHint: 'Use "add" to add entries.',
        headerTitle: 'TEST LIST',
        wildcardExample: 'c_test*',
        regexExample: 'c_(test).*'
    });
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
    buildFactory();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// createListCommands — returns a registerCommands function
// ============================================================================

describe('createListCommands', () => {
    it('returns a function', () => {
        expect(typeof registerCommands).toBe('function');
    });

    describe('registerCommands', () => {
        it('registers add-to, remove-from, and list commands', () => {
            const registeredNames = [];
            const mockProgram = {
                command: vi.fn((name) => {
                    registeredNames.push(name);
                    return {
                        description: vi.fn().mockReturnValue({
                            action: vi.fn()
                        })
                    };
                })
            };

            registerCommands(mockProgram);

            expect(mockProgram.command).toHaveBeenCalledTimes(3);
            expect(registeredNames).toContain('add-to-testlist');
            expect(registeredNames).toContain('remove-from-testlist');
            expect(registeredNames).toContain('list-testlist');
        });
    });

    // ------------------------------------------------------------------
    // listCommand
    // ------------------------------------------------------------------

    describe('listCommand (action handler)', () => {
        function getActionHandler(commandName) {
            let handler;
            const mockProgram = {
                command: vi.fn((name) => ({
                    description: vi.fn().mockReturnValue({
                        action: vi.fn((fn) => {
                            if (name === commandName) {
                                handler = fn;
                            }
                        })
                    })
                }))
            };
            registerCommands(mockProgram);
            return handler;
        }

        it('prints empty message when no entries', () => {
            const handler = getActionHandler('list-testlist');
            handler();

            expect(console.log).toHaveBeenCalledWith('List is empty.');
        });

        it('prints entries with proper formatting', () => {
            listEntriesMock.mockReturnValue([
                { type: 'exact', id: 'c_prefA' },
                { type: 'wildcard', pattern: 'c_test*', reason: 'Testing', realms: ['EU05'] }
            ]);
            buildFactory({ listEntries: listEntriesMock });

            const handler = getActionHandler('list-testlist');
            handler();

            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('TEST LIST'));
            expect(console.log).toHaveBeenCalledWith('Total entries: 2\n');
        });
    });

    // ------------------------------------------------------------------
    // addCommand
    // ------------------------------------------------------------------

    describe('addCommand (action handler)', () => {
        function getAddHandler() {
            let handler;
            const mockProgram = {
                command: vi.fn((name) => ({
                    description: vi.fn().mockReturnValue({
                        action: vi.fn((fn) => {
                            if (name === 'add-to-testlist') {
                                handler = fn;
                            }
                        })
                    })
                }))
            };
            registerCommands(mockProgram);
            return handler;
        }

        it('adds exact entry via interactive prompts', async () => {
            mockPrompt
                .mockResolvedValueOnce({ type: 'exact' })
                .mockResolvedValueOnce({ pattern: 'c_newPref', reason: 'Test reason' })
                .mockResolvedValueOnce({ realmScope: 'all' });

            const handler = getAddHandler();
            await handler();

            expect(addToListMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'exact',
                    id: 'c_newPref',
                    reason: 'Test reason'
                })
            );
        });

        it('adds entry with specific realms', async () => {
            mockPrompt
                .mockResolvedValueOnce({ type: 'wildcard' })
                .mockResolvedValueOnce({ pattern: 'c_test*', reason: '' })
                .mockResolvedValueOnce({ realmScope: 'select' })
                .mockResolvedValueOnce({ realms: ['EU05', 'GB'] });

            const handler = getAddHandler();
            await handler();

            expect(addToListMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'wildcard',
                    pattern: 'c_test*',
                    realms: ['EU05', 'GB']
                })
            );
        });

        it('logs warning when entry already exists', async () => {
            addToListMock.mockReturnValue(false);

            mockPrompt
                .mockResolvedValueOnce({ type: 'exact' })
                .mockResolvedValueOnce({ pattern: 'c_existing', reason: '' })
                .mockResolvedValueOnce({ realmScope: 'all' });

            const handler = getAddHandler();
            await handler();

            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('already exists')
            );
        });
    });

    // ------------------------------------------------------------------
    // removeCommand
    // ------------------------------------------------------------------

    describe('removeCommand (action handler)', () => {
        function getRemoveHandler() {
            let handler;
            const mockProgram = {
                command: vi.fn((name) => ({
                    description: vi.fn().mockReturnValue({
                        action: vi.fn((fn) => {
                            if (name === 'remove-from-testlist') {
                                handler = fn;
                            }
                        })
                    })
                }))
            };
            registerCommands(mockProgram);
            return handler;
        }

        it('shows empty message when list is empty', async () => {
            const handler = getRemoveHandler();
            await handler();

            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('empty')
            );
            expect(mockPrompt).not.toHaveBeenCalled();
        });

        it('removes selected entry after confirmation', async () => {
            listEntriesMock.mockReturnValue([
                { type: 'exact', id: 'c_prefA' }
            ]);
            buildFactory({ listEntries: listEntriesMock });

            mockPrompt
                .mockResolvedValueOnce({ selected: 'c_prefA' })
                .mockResolvedValueOnce({ confirm: true });

            const handler = getRemoveHandler();
            await handler();

            expect(removeFromListMock).toHaveBeenCalledWith('c_prefA');
        });

        it('cancels removal when user declines', async () => {
            listEntriesMock.mockReturnValue([
                { type: 'exact', id: 'c_prefA' }
            ]);
            buildFactory({ listEntries: listEntriesMock });

            mockPrompt
                .mockResolvedValueOnce({ selected: 'c_prefA' })
                .mockResolvedValueOnce({ confirm: false });

            const handler = getRemoveHandler();
            await handler();

            expect(removeFromListMock).not.toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith('Removal cancelled.');
        });

        it('logs error when entry not found', async () => {
            listEntriesMock.mockReturnValue([
                { type: 'exact', id: 'c_prefA' }
            ]);
            removeFromListMock.mockReturnValue(false);
            buildFactory({
                listEntries: listEntriesMock,
                removeFromList: removeFromListMock
            });

            mockPrompt
                .mockResolvedValueOnce({ selected: 'c_prefA' })
                .mockResolvedValueOnce({ confirm: true });

            const handler = getRemoveHandler();
            await handler();

            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('not found')
            );
        });
    });
});
