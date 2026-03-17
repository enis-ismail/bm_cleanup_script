/**
 * Shared List CLI Command Factory
 * Generates CLI commands (add, remove, list) for either blacklist or whitelist.
 * Eliminates duplication between blacklist.js and whitelist.js.
 *
 * @module listCommands
 */

import inquirer from 'inquirer';
import { LOG_PREFIX } from '../../../config/constants.js';
import { getAvailableRealms } from '../../../index.js';

/**
 * Create CLI command registration and handler functions for a list type.
 *
 * @param {Object} options - Factory configuration
 * @param {string} options.listName - Display name ('blacklist' or 'whitelist')
 * @param {Object} options.helpers - Helper module with addToList, removeFromList, listEntries
 * @param {Function} options.helpers.addToList - Add an entry
 * @param {Function} options.helpers.removeFromList - Remove an entry by key
 * @param {Function} options.helpers.listEntries - Get all entries
 * @param {Object} options.descriptions - Command descriptions
 * @param {string} options.descriptions.add - Description for add command
 * @param {string} options.descriptions.remove - Description for remove command
 * @param {string} options.descriptions.list - Description for list command
 * @param {string} options.emptyMessage - Message when list is empty (list command)
 * @param {string} options.emptyHint - Hint shown after empty message
 * @param {string} options.headerTitle - Title for the list display header
 * @param {string} options.wildcardExample - Example wildcard pattern (e.g. 'c_adyen*')
 * @param {string} options.regexExample - Example regex pattern (e.g. 'c_(adyen|klarna).*')
 * @returns {Function} registerCommands(program) function
 */
export function createListCommands({
    listName,
    helpers,
    descriptions,
    emptyMessage,
    emptyHint,
    headerTitle,
    wildcardExample,
    regexExample
}) {
    const { addToList, removeFromList, listEntries } = helpers;

    /**
     * Interactive prompt: add an entry to the list.
     * @param {string} pattern - The preference ID or pattern to add
     * @private
     */
    async function addCommand(pattern) {
        if (!pattern || !pattern.trim()) {
            console.log(`${LOG_PREFIX.ERROR} Pattern is required.`
                + ` Usage: add-to-${listName} <pattern>`);
            return;
        }

        const typeAnswer = await inquirer.prompt([{
            type: 'list',
            name: 'type',
            message: `What type of ${listName} entry?`,
            choices: [
                { name: 'Exact match (single preference ID)', value: 'exact' },
                { name: `Wildcard pattern (e.g., ${wildcardExample})`, value: 'wildcard' },
                { name: `Regex pattern (e.g., ${regexExample})`, value: 'regex' }
            ]
        }]);

        const reasonAnswer = await inquirer.prompt([{
            type: 'list',
            name: 'reason',
            message: `Reason for adding to ${listName}:`,
            choices: [
                { name: 'No reason', value: '' },
                { name: 'No longer needed', value: 'No longer needed' },
                { name: 'Deprecated', value: 'Deprecated' },
                { name: 'Security risk', value: 'Security risk' },
                { name: 'Test only', value: 'Test only' },
                { name: 'Duplicate', value: 'Duplicate' }
            ]
        }]);

        const answers = { pattern: pattern.trim(), reason: reasonAnswer.reason };

        const availableRealms = getAvailableRealms();
        const realmAnswer = await inquirer.prompt([{
            type: 'list',
            name: 'realmScope',
            message: 'Apply to which realms?',
            choices: [
                { name: 'All realms (global)', value: 'all' },
                { name: 'Select specific realms', value: 'select' }
            ]
        }]);

        let selectedRealms = [];
        if (realmAnswer.realmScope === 'select') {
            const realmSelection = await inquirer.prompt([{
                type: 'checkbox',
                name: 'realms',
                message: 'Select realms:',
                choices: availableRealms,
                validate: (input) => input.length > 0 ? true : 'Select at least one realm'
            }]);
            selectedRealms = realmSelection.realms;
        }

        const entry = {
            type: typeAnswer.type,
            reason: answers.reason || undefined,
            realms: selectedRealms.length > 0 ? selectedRealms : undefined
        };

        if (typeAnswer.type === 'exact') {
            entry.id = answers.pattern.trim();
        } else {
            entry.pattern = answers.pattern.trim();
        }

        const added = addToList(entry);

        if (added) {
            const display = entry.id || entry.pattern;
            const realmDisplay = selectedRealms.length > 0
                ? ` [realms: ${selectedRealms.join(', ')}]`
                : ' [all realms]';
            console.log(
                `${LOG_PREFIX.INFO} Added to ${listName}: ${display}`
                + ` (${typeAnswer.type})${realmDisplay}`
            );
            if (answers.reason) {
                console.log(`  Reason: ${answers.reason}`);
            }
        } else {
            console.log(`${LOG_PREFIX.WARNING} Entry already exists in ${listName}`);
        }
    }

    /**
     * Interactive prompt: remove an entry from the list.
     * @private
     */
    async function removeCommand() {
        const entries = listEntries();

        if (entries.length === 0) {
            console.log(`${headerTitle} is empty — nothing to remove.`);
            return;
        }

        const choices = entries.map(entry => {
            const key = entry.type === 'exact'
                ? (entry.id || entry.pattern)
                : entry.pattern;
            const realmTag = Array.isArray(entry.realms) && entry.realms.length > 0
                ? ` [${entry.realms.join(', ')}]`
                : ' [all realms]';
            const label = `[${entry.type}] ${key}${realmTag}`
                + `${entry.reason ? ` — ${entry.reason}` : ''}`;
            return { name: label, value: key };
        });

        const { selected } = await inquirer.prompt([{
            type: 'list',
            name: 'selected',
            message: 'Select an entry to remove:',
            choices
        }]);

        const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Remove "${selected}" from ${listName}?`,
            default: true
        }]);

        if (!confirm) {
            console.log('Removal cancelled.');
            return;
        }

        const removed = removeFromList(selected);

        if (removed) {
            console.log(`${LOG_PREFIX.INFO} Removed from ${listName}: ${selected}`);
        } else {
            console.log(`${LOG_PREFIX.ERROR} Entry not found in ${listName}`);
        }
    }

    /**
     * Display all entries in the list.
     * @private
     */
    function listCommand() {
        const entries = listEntries();

        if (entries.length === 0) {
            console.log(emptyMessage);
            console.log(emptyHint + '\n');
            return;
        }

        console.log('\n================================================================================');
        console.log(headerTitle);
        console.log('================================================================================\n');
        console.log(`Total entries: ${entries.length}\n`);

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const key = entry.type === 'exact'
                ? (entry.id || entry.pattern)
                : entry.pattern;
            const num = (i + 1).toString().padStart(3, ' ');
            const realmTag = Array.isArray(entry.realms) && entry.realms.length > 0
                ? `  [realms: ${entry.realms.join(', ')}]`
                : '  [all realms]';
            console.log(`  ${num}. [${entry.type.toUpperCase().padEnd(8)}] ${key}${realmTag}`);
            if (entry.reason) {
                console.log(`       Reason: ${entry.reason}`);
            }
        }

        console.log('\n================================================================================\n');
    }

    /**
     * Register add/remove/list commands on the Commander program.
     * @param {import('commander').Command} program - Commander.js program instance
     */
    function registerCommands(program) {
        program
            .command(`add-to-${listName} <pattern>`)
            .description(descriptions.add)
            .action(addCommand);

        program
            .command(`remove-from-${listName}`)
            .description(descriptions.remove)
            .action(removeCommand);

        program
            .command(`list-${listName}`)
            .description(descriptions.list)
            .action(listCommand);
    }

    return registerCommands;
}
