/**
 * Whitelist CLI Commands
 * Manage the preference whitelist (add, remove, list).
 * Uses the shared createListCommands factory.
 */

import { createListCommands } from '../helpers/listCommands.js';
import {
    addToWhitelist,
    removeFromWhitelist,
    listWhitelist
} from '../helpers/whitelistHelper.js';

/**
 * Register whitelist management commands.
 * @param {import('commander').Command} program - Commander.js program instance
 */
export const registerWhitelistCommands = createListCommands({
    listName: 'whitelist',
    helpers: {
        addToList: addToWhitelist,
        removeFromList: removeFromWhitelist,
        listEntries: listWhitelist
    },
    descriptions: {
        add: 'Add a preference pattern to the whitelist (only these can be tested/deleted)',
        remove: 'Remove a preference pattern from the whitelist',
        list: 'Show all whitelisted preference patterns'
    },
    emptyMessage: 'Whitelist is empty. All preferences are eligible for analysis.',
    emptyHint: 'Use "add-to-whitelist" to restrict analysis to specific preferences.',
    headerTitle: 'PREFERENCE WHITELIST',
    wildcardExample: 'c_test*',
    regexExample: 'c_(test|pilot).*'
});
