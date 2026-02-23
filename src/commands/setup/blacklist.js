/**
 * Blacklist CLI Commands
 * Manage the preference blacklist (add, remove, list)
 */

import inquirer from 'inquirer';
import {
    addToBlacklist,
    removeFromBlacklist,
    listBlacklist
} from '../../helpers/blacklistHelper.js';
import { LOG_PREFIX } from '../../config/constants.js';

/**
 * Register blacklist management commands
 * @param {Command} program - Commander.js program instance
 */
export function registerBlacklistCommands(program) {
    program
        .command('add-to-blacklist')
        .description('Add a preference pattern to the blacklist (protected from deletion)')
        .action(addToBlacklistCommand);

    program
        .command('remove-from-blacklist')
        .description('Remove a preference pattern from the blacklist')
        .action(removeFromBlacklistCommand);

    program
        .command('list-blacklist')
        .description('Show all blacklisted preference patterns')
        .action(listBlacklistCommand);
}

// ============================================================================
// ADD TO BLACKLIST
// ============================================================================

async function addToBlacklistCommand() {
    const typeAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'type',
        message: 'What type of blacklist entry?',
        choices: [
            { name: 'Exact match (single preference ID)', value: 'exact' },
            { name: 'Wildcard pattern (e.g., c_adyen*)', value: 'wildcard' },
            { name: 'Regex pattern (e.g., c_(adyen|klarna).*)', value: 'regex' }
        ]
    }]);

    const patternPrompt = typeAnswer.type === 'exact'
        ? 'Enter the preference ID:'
        : `Enter the ${typeAnswer.type} pattern:`;

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'pattern',
            message: patternPrompt,
            validate: (input) => input.trim().length > 0 || 'Pattern cannot be empty'
        },
        {
            type: 'input',
            name: 'reason',
            message: 'Reason for blacklisting (optional):',
            default: ''
        }
    ]);

    const entry = {
        type: typeAnswer.type,
        reason: answers.reason || undefined
    };

    if (typeAnswer.type === 'exact') {
        entry.id = answers.pattern.trim();
    } else {
        entry.pattern = answers.pattern.trim();
    }

    const added = addToBlacklist(entry);

    if (added) {
        const display = entry.id || entry.pattern;
        console.log(`${LOG_PREFIX.INFO} Added to blacklist: ${display} (${typeAnswer.type})`);
        if (answers.reason) {
            console.log(`  Reason: ${answers.reason}`);
        }
    } else {
        console.log(`${LOG_PREFIX.WARNING} Entry already exists in blacklist`);
    }
}

// ============================================================================
// REMOVE FROM BLACKLIST
// ============================================================================

async function removeFromBlacklistCommand() {
    const entries = listBlacklist();

    if (entries.length === 0) {
        console.log('Blacklist is empty — nothing to remove.');
        return;
    }

    const choices = entries.map(entry => {
        const key = entry.type === 'exact'
            ? (entry.id || entry.pattern)
            : entry.pattern;
        const label = `[${entry.type}] ${key}${entry.reason ? ` — ${entry.reason}` : ''}`;
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
        message: `Remove "${selected}" from blacklist?`,
        default: true
    }]);

    if (!confirm) {
        console.log('Removal cancelled.');
        return;
    }

    const removed = removeFromBlacklist(selected);

    if (removed) {
        console.log(`${LOG_PREFIX.INFO} Removed from blacklist: ${selected}`);
    } else {
        console.log(`${LOG_PREFIX.ERROR} Entry not found in blacklist`);
    }
}

// ============================================================================
// LIST BLACKLIST
// ============================================================================

function listBlacklistCommand() {
    const entries = listBlacklist();

    if (entries.length === 0) {
        console.log('Blacklist is empty. No preferences are protected from deletion.');
        console.log('Use "add-to-blacklist" to add entries.\n');
        return;
    }

    console.log('\n================================================================================');
    console.log('PREFERENCE BLACKLIST');
    console.log('================================================================================\n');
    console.log(`Total entries: ${entries.length}\n`);

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const key = entry.type === 'exact'
            ? (entry.id || entry.pattern)
            : entry.pattern;
        const num = (i + 1).toString().padStart(3, ' ');
        console.log(`  ${num}. [${entry.type.toUpperCase().padEnd(8)}] ${key}`);
        if (entry.reason) {
            console.log(`       Reason: ${entry.reason}`);
        }
    }

    console.log('\n================================================================================\n');
}
