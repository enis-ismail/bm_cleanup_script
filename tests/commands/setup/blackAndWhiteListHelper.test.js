import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/scripts/loggingScript/log.js', () => ({
    logError: vi.fn()
}));

import { createListHelper } from '../../../src/commands/setup/helpers/blackAndWhiteListHelper.js';
import { logError } from '../../../src/scripts/loggingScript/log.js';

// ============================================================================
// Helpers
// ============================================================================

let tmpDir;
let configFilePath;

/**
 * Build a helper instance that reads/writes to a temp config file.
 * We override the internal path by writing the config file at the expected
 * location relative to blackAndWhiteListHelper.js (../../config/).
 */
function buildHelper(listType = 'blacklist', filterMode = 'exclude', entries = []) {
    const configFileName = `test_${listType}.json`;

    // The helper resolves relative to its own __dirname → src/commands/setup/helpers
    // then ../../.. → src/config/<configFileName>
    // We can't control that path, so instead we write real files and use the
    // factory with a custom configFileName that doesn't collide.
    // But since the path is hard-coded, we need to test via the actual file path.
    // Let's write to a temp dir and use a different approach:
    // We'll test the pure business logic by calling the returned functions directly.

    // For unit testing, we mock fs operations at the call site.
    return createListHelper({ listType, configFileName, filterMode });
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-helper-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

// ============================================================================
// createListHelper — blacklist (exclude mode)
// ============================================================================

describe('createListHelper — blacklist (exclude mode)', () => {
    let helper;
    let listPath;

    beforeEach(() => {
        helper = createListHelper({
            listType: 'blacklist',
            configFileName: 'preference_blacklist.json',
            filterMode: 'exclude'
        });
        // Determine where the helper reads/writes
        // It resolves to src/config/preference_blacklist.json
        const helperDir = path.resolve(
            path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
            '../../../src/config'
        );
        listPath = path.join(helperDir, 'preference_blacklist.json');
    });

    describe('loadList', () => {
        it('returns object with description and blacklist array', () => {
            const result = helper.loadList();
            expect(result).toHaveProperty('description');
            expect(result).toHaveProperty('blacklist');
            expect(Array.isArray(result.blacklist)).toBe(true);
        });
    });

    describe('listEntries', () => {
        it('returns an array', () => {
            const entries = helper.listEntries();
            expect(Array.isArray(entries)).toBe(true);
        });
    });
});

// ============================================================================
// createListHelper — with mocked fs for isolated tests
// ============================================================================

describe('createListHelper — isolated with mocked fs', () => {
    let helper;
    let savedConfig;

    beforeEach(() => {
        savedConfig = null;

        // Mock fs to intercept reads/writes
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            description: 'Test list',
            testlist: [
                { type: 'exact', id: 'c_prefA' },
                { type: 'wildcard', pattern: 'c_adyen*' },
                { type: 'regex', pattern: 'c_(klarna|paypal).*' }
            ]
        }));
        vi.spyOn(fs, 'writeFileSync').mockImplementation((filePath, content) => {
            savedConfig = JSON.parse(content.replace(/\n$/, ''));
        });

        helper = createListHelper({
            listType: 'testlist',
            configFileName: 'test_list.json',
            filterMode: 'exclude'
        });
    });

    // ------------------------------------------------------------------
    // loadList
    // ------------------------------------------------------------------

    describe('loadList', () => {
        it('loads and returns parsed config', () => {
            const result = helper.loadList();

            expect(result.description).toBe('Test list');
            expect(result.testlist).toHaveLength(3);
            expect(result.testlist[0]).toEqual({ type: 'exact', id: 'c_prefA' });
        });

        it('returns empty config when file does not exist', () => {
            fs.existsSync.mockReturnValue(false);

            const result = helper.loadList();

            expect(result.description).toBe('');
            expect(result.testlist).toEqual([]);
        });

        it('returns empty config on JSON parse error', () => {
            fs.readFileSync.mockReturnValue('invalid json{{{');

            const result = helper.loadList();

            expect(result.testlist).toEqual([]);
            expect(logError).toHaveBeenCalled();
        });

        it('handles config without listType key', () => {
            fs.readFileSync.mockReturnValue(JSON.stringify({
                description: 'No list key'
            }));

            const result = helper.loadList();

            expect(result.testlist).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // saveList
    // ------------------------------------------------------------------

    describe('saveList', () => {
        it('writes config to file as JSON', () => {
            const config = {
                description: 'Updated',
                testlist: [{ type: 'exact', id: 'c_new' }]
            };

            helper.saveList(config);

            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            expect(savedConfig).toEqual(config);
        });
    });

    // ------------------------------------------------------------------
    // isInList
    // ------------------------------------------------------------------

    describe('isInList', () => {
        it('matches exact entry', () => {
            expect(helper.isInList('c_prefA')).toBe(true);
        });

        it('does not match non-existing exact entry', () => {
            expect(helper.isInList('c_prefZ')).toBe(false);
        });

        it('matches wildcard entry', () => {
            expect(helper.isInList('c_adyenPayment')).toBe(true);
        });

        it('does not match wildcard when pattern differs', () => {
            expect(helper.isInList('c_stripePayment')).toBe(false);
        });

        it('matches regex entry', () => {
            expect(helper.isInList('c_klarnaCheckout')).toBe(true);
            expect(helper.isInList('c_paypalExpress')).toBe(true);
        });

        it('does not match regex when pattern differs', () => {
            expect(helper.isInList('c_afterpay')).toBe(false);
        });

        it('accepts pre-loaded entries', () => {
            const entries = [{ type: 'exact', id: 'c_custom' }];
            expect(helper.isInList('c_custom', entries)).toBe(true);
            expect(helper.isInList('c_other', entries)).toBe(false);
        });

        it('handles realm-scoped entries — matches correct realm', () => {
            const entries = [{ type: 'exact', id: 'c_prefA', realms: ['EU05'] }];

            expect(helper.isInList('c_prefA', entries, 'EU05')).toBe(true);
        });

        it('handles realm-scoped entries — rejects wrong realm', () => {
            const entries = [{ type: 'exact', id: 'c_prefA', realms: ['EU05'] }];

            expect(helper.isInList('c_prefA', entries, 'APAC')).toBe(false);
        });

        it('handles realm-scoped entries — no realm provided', () => {
            const entries = [{ type: 'exact', id: 'c_prefA', realms: ['EU05'] }];

            expect(helper.isInList('c_prefA', entries, null)).toBe(false);
        });

        it('entries without realms apply to all realms', () => {
            const entries = [{ type: 'exact', id: 'c_prefA' }];

            expect(helper.isInList('c_prefA', entries, 'EU05')).toBe(true);
            expect(helper.isInList('c_prefA', entries, 'APAC')).toBe(true);
            expect(helper.isInList('c_prefA', entries, null)).toBe(true);
        });

        it('handles invalid regex gracefully', () => {
            const entries = [{ type: 'regex', pattern: '[invalid(' }];

            expect(helper.isInList('test', entries)).toBe(false);
            expect(logError).toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------
    // filterByList — exclude mode (blacklist)
    // ------------------------------------------------------------------

    describe('filterByList — exclude mode', () => {
        it('blocks matched IDs and allows unmatched', () => {
            const ids = ['c_prefA', 'c_prefB', 'c_adyenTest'];

            const result = helper.filterByList(ids);

            expect(result.blocked).toContain('c_prefA');
            expect(result.blocked).toContain('c_adyenTest');
            expect(result.allowed).toContain('c_prefB');
        });

        it('returns all allowed when list is empty', () => {
            fs.readFileSync.mockReturnValue(JSON.stringify({
                description: '',
                testlist: []
            }));

            const ids = ['c_a', 'c_b'];
            const result = helper.filterByList(ids);

            expect(result.allowed).toEqual(['c_a', 'c_b']);
            expect(result.blocked).toEqual([]);
        });

        it('accepts pre-loaded entries', () => {
            const entries = [{ type: 'exact', id: 'c_block' }];
            const ids = ['c_block', 'c_keep'];

            const result = helper.filterByList(ids, entries);

            expect(result.blocked).toEqual(['c_block']);
            expect(result.allowed).toEqual(['c_keep']);
        });

        it('filters with realm scope', () => {
            const entries = [
                { type: 'exact', id: 'c_prefA', realms: ['EU05'] }
            ];
            const ids = ['c_prefA', 'c_prefB'];

            const eu05Result = helper.filterByList(ids, entries, 'EU05');
            expect(eu05Result.blocked).toEqual(['c_prefA']);
            expect(eu05Result.allowed).toEqual(['c_prefB']);

            const apacResult = helper.filterByList(ids, entries, 'APAC');
            expect(apacResult.blocked).toEqual([]);
            expect(apacResult.allowed).toEqual(['c_prefA', 'c_prefB']);
        });
    });

    // ------------------------------------------------------------------
    // addToList
    // ------------------------------------------------------------------

    describe('addToList', () => {
        it('adds exact entry and saves', () => {
            const added = helper.addToList({ type: 'exact', id: 'c_newPref' });

            expect(added).toBe(true);
            expect(savedConfig.testlist).toContainEqual(
                expect.objectContaining({ type: 'exact', id: 'c_newPref' })
            );
        });

        it('adds wildcard entry with reason', () => {
            const added = helper.addToList({
                type: 'wildcard',
                pattern: 'c_test*',
                reason: 'Testing'
            });

            expect(added).toBe(true);
            expect(savedConfig.testlist).toContainEqual(
                expect.objectContaining({
                    type: 'wildcard',
                    pattern: 'c_test*',
                    reason: 'Testing'
                })
            );
        });

        it('adds entry with realm scope', () => {
            const added = helper.addToList({
                type: 'exact',
                id: 'c_realmPref',
                realms: ['EU05', 'GB']
            });

            expect(added).toBe(true);
            expect(savedConfig.testlist).toContainEqual(
                expect.objectContaining({
                    type: 'exact',
                    id: 'c_realmPref',
                    realms: ['EU05', 'GB']
                })
            );
        });

        it('rejects duplicate exact entry', () => {
            const added = helper.addToList({ type: 'exact', id: 'c_prefA' });

            expect(added).toBe(false);
        });

        it('rejects duplicate wildcard entry', () => {
            const added = helper.addToList({ type: 'wildcard', pattern: 'c_adyen*' });

            expect(added).toBe(false);
        });

        it('rejects duplicate regex entry', () => {
            const added = helper.addToList({
                type: 'regex',
                pattern: 'c_(klarna|paypal).*'
            });

            expect(added).toBe(false);
        });

        it('normalizes entry — uses pattern key for non-exact, id for exact', () => {
            helper.addToList({ type: 'exact', pattern: 'c_viaPattern' });

            const addedEntry = savedConfig.testlist.find(e => e.id === 'c_viaPattern');
            expect(addedEntry).toBeDefined();
            expect(addedEntry.type).toBe('exact');
        });

        it('does not include empty reason or realms', () => {
            helper.addToList({
                type: 'exact',
                id: 'c_clean',
                reason: '',
                realms: []
            });

            const addedEntry = savedConfig.testlist.find(e => e.id === 'c_clean');
            expect(addedEntry).not.toHaveProperty('reason');
            expect(addedEntry).not.toHaveProperty('realms');
        });
    });

    // ------------------------------------------------------------------
    // removeFromList
    // ------------------------------------------------------------------

    describe('removeFromList', () => {
        it('removes existing exact entry', () => {
            const removed = helper.removeFromList('c_prefA');

            expect(removed).toBe(true);
            expect(savedConfig.testlist.find(e => e.id === 'c_prefA')).toBeUndefined();
        });

        it('removes existing wildcard entry', () => {
            const removed = helper.removeFromList('c_adyen*');

            expect(removed).toBe(true);
        });

        it('removes existing regex entry', () => {
            const removed = helper.removeFromList('c_(klarna|paypal).*');

            expect(removed).toBe(true);
        });

        it('returns false for non-existing entry', () => {
            const removed = helper.removeFromList('c_nonexistent');

            expect(removed).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // listEntries
    // ------------------------------------------------------------------

    describe('listEntries', () => {
        it('returns all entries from config', () => {
            const entries = helper.listEntries();

            expect(entries).toHaveLength(3);
            expect(entries[0].id).toBe('c_prefA');
        });
    });
});

// ============================================================================
// createListHelper — whitelist (include mode)
// ============================================================================

describe('createListHelper — whitelist (include mode)', () => {
    let helper;

    beforeEach(() => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            description: 'Test whitelist',
            testwhitelist: [
                { type: 'exact', id: 'c_allowed' },
                { type: 'wildcard', pattern: 'c_test*' }
            ]
        }));
        vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

        helper = createListHelper({
            listType: 'testwhitelist',
            configFileName: 'test_whitelist.json',
            filterMode: 'include'
        });
    });

    describe('filterByList — include mode', () => {
        it('allows matched IDs and blocks unmatched', () => {
            const ids = ['c_allowed', 'c_testFeature', 'c_other'];

            const result = helper.filterByList(ids);

            expect(result.allowed).toContain('c_allowed');
            expect(result.allowed).toContain('c_testFeature');
            expect(result.blocked).toContain('c_other');
        });

        it('allows all when whitelist is empty (passthrough)', () => {
            vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                description: '',
                testwhitelist: []
            }));

            const ids = ['c_a', 'c_b', 'c_c'];
            const result = helper.filterByList(ids);

            expect(result.allowed).toEqual(ids);
            expect(result.blocked).toEqual([]);
        });

        it('filters with realm scope in include mode', () => {
            const entries = [
                { type: 'exact', id: 'c_allowed', realms: ['EU05'] }
            ];
            const ids = ['c_allowed', 'c_other'];

            const eu05Result = helper.filterByList(ids, entries, 'EU05');
            expect(eu05Result.allowed).toEqual(['c_allowed']);
            expect(eu05Result.blocked).toEqual(['c_other']);

            // On APAC, the realm-scoped entry does not match so c_allowed is blocked
            const apacResult = helper.filterByList(ids, entries, 'APAC');
            expect(apacResult.allowed).toEqual([]);
            expect(apacResult.blocked).toEqual(['c_allowed', 'c_other']);
        });
    });
});

// ============================================================================
// Wildcard edge cases
// ============================================================================

describe('wildcard pattern matching', () => {
    let helper;

    beforeEach(() => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    });

    it('matches ? as single character', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            description: '',
            wc: [{ type: 'wildcard', pattern: 'c_pref?' }]
        }));

        helper = createListHelper({
            listType: 'wc',
            configFileName: 'wc.json',
            filterMode: 'exclude'
        });

        expect(helper.isInList('c_prefA')).toBe(true);
        expect(helper.isInList('c_pref1')).toBe(true);
        expect(helper.isInList('c_pref')).toBe(false);
        expect(helper.isInList('c_prefAB')).toBe(false);
    });

    it('escapes regex special characters in wildcard patterns', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            description: '',
            wc: [{ type: 'wildcard', pattern: 'c_pref.value*' }]
        }));

        helper = createListHelper({
            listType: 'wc',
            configFileName: 'wc.json',
            filterMode: 'exclude'
        });

        // The dot should be literal, not regex any-char
        expect(helper.isInList('c_pref.value')).toBe(true);
        expect(helper.isInList('c_pref.valueTest')).toBe(true);
        expect(helper.isInList('c_prefXvalue')).toBe(false);
    });

    it('is case-insensitive', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            description: '',
            wc: [{ type: 'wildcard', pattern: 'C_PREF*' }]
        }));

        helper = createListHelper({
            listType: 'wc',
            configFileName: 'wc.json',
            filterMode: 'exclude'
        });

        expect(helper.isInList('c_prefTest')).toBe(true);
        expect(helper.isInList('C_PREFTEST')).toBe(true);
    });
});
