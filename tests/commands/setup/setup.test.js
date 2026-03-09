import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

const mockPrompt = vi.fn();
vi.mock('inquirer', () => ({
    default: { prompt: (...args) => mockPrompt(...args) }
}));

vi.mock('../../../src/index.js', () => ({
    addRealmToConfig: vi.fn(),
    removeRealmFromConfig: vi.fn(),
    getAvailableRealms: vi.fn(() => ['EU05', 'APAC'])
}));

vi.mock('../../../src/commands/prompts/realmPrompts.js', () => ({
    addRealmPrompts: vi.fn(() => [{ name: 'name' }]),
    selectRealmToRemovePrompt: vi.fn((realms) => [{ name: 'realmToRemove', choices: realms }]),
    confirmRealmRemovalPrompt: vi.fn((name) => [{ name: 'confirm' }])
}));

import { registerSetupCommands } from '../../../src/commands/setup/setup.js';
import { addRealmToConfig, removeRealmFromConfig, getAvailableRealms } from '../../../src/index.js';

// ============================================================================
// Helpers
// ============================================================================

function extractActionHandlers() {
    const handlers = {};
    const mockProgram = {
        command: vi.fn((name) => ({
            description: vi.fn().mockReturnValue({
                action: vi.fn((fn) => {
                    handlers[name] = fn;
                })
            })
        }))
    };
    registerSetupCommands(mockProgram);
    return { handlers, mockProgram };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('registerSetupCommands', () => {
    it('registers add-realm and remove-realm commands', () => {
        const { mockProgram } = extractActionHandlers();

        expect(mockProgram.command).toHaveBeenCalledTimes(2);
        expect(mockProgram.command).toHaveBeenCalledWith('add-realm');
        expect(mockProgram.command).toHaveBeenCalledWith('remove-realm');
    });
});

describe('add-realm action', () => {
    it('prompts user and calls addRealmToConfig', async () => {
        mockPrompt.mockResolvedValueOnce({
            name: 'new-realm',
            hostname: 'new-realm.dx.commercecloud.salesforce.com',
            clientId: 'client123',
            clientSecret: 'secret456',
            siteTemplatesPath: 'sites/template',
            instanceType: 'development'
        });

        const { handlers } = extractActionHandlers();
        await handlers['add-realm']();

        expect(addRealmToConfig).toHaveBeenCalledWith(
            'new-realm',
            'new-realm.dx.commercecloud.salesforce.com',
            'client123',
            'secret456',
            'sites/template',
            'development'
        );
    });
});

describe('remove-realm action', () => {
    it('prompts user and calls removeRealmFromConfig on confirm', async () => {
        mockPrompt
            .mockResolvedValueOnce({ realmToRemove: 'APAC' })
            .mockResolvedValueOnce({ confirm: true });

        const { handlers } = extractActionHandlers();
        await handlers['remove-realm']();

        expect(removeRealmFromConfig).toHaveBeenCalledWith('APAC');
    });

    it('does not remove when user declines confirmation', async () => {
        mockPrompt
            .mockResolvedValueOnce({ realmToRemove: 'APAC' })
            .mockResolvedValueOnce({ confirm: false });

        const { handlers } = extractActionHandlers();
        await handlers['remove-realm']();

        expect(removeRealmFromConfig).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith('Realm removal cancelled.');
    });

    it('shows message and exits when no realms available', async () => {
        getAvailableRealms.mockReturnValue([]);

        const { handlers } = extractActionHandlers();
        await handlers['remove-realm']();

        expect(console.log).toHaveBeenCalledWith('No realms available to remove.');
        expect(mockPrompt).not.toHaveBeenCalled();
    });
});
