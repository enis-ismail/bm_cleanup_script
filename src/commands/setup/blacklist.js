/**
 * Blacklist CLI Commands
 * Manage the preference blacklist (add, remove, list).
 * Uses the shared createListCommands factory.
 */

import { createListCommands } from './helpers/listCommands.js';
import {
    addToBlacklist,
    removeFromBlacklist,
    listBlacklist
} from './helpers/blacklistHelper.js';

/**
 * Register blacklist management commands.
 * @param {import('commander').Command} program - Commander.js program instance
 */
export const registerBlacklistCommands = createListCommands({
    listName: 'blacklist',
    helpers: {
        addToList: addToBlacklist,
        removeFromList: removeFromBlacklist,
        listEntries: listBlacklist
    },
    descriptions: {
        add: 'Add a preference pattern to the blacklist (protected from deletion)',
        remove: 'Remove a preference pattern from the blacklist',
        list: 'Show all blacklisted preference patterns'
    },
    emptyMessage: 'Blacklist is empty. No preferences are protected from deletion.',
    emptyHint: 'Use "add-to-blacklist" to add entries.',
    headerTitle: 'PREFERENCE BLACKLIST',
    wildcardExample: 'c_adyen*',
    regexExample: 'c_(adyen|klarna).*'
});
