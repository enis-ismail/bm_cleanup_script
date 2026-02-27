/**
 * Whitelist CLI Commands
 * Manage the preference whitelist (add, remove, list)
 */

import inquirer from 'inquirer';
import {
    addToWhitelist,
    removeFromWhitelist,
    listWhitelist
} from './helpers/whitelistHelper.js';
import { LOG_PREFIX } from '../../config/constants.js';

/**
 * Register whitelist management commands
 * @param {Command} program - Commander.js program instance
 */
export function registerWhitelistCommands(program) {
    program
        .command('add-to-whitelist')
        .description('Add a preference pattern to the whitelist (only these can be tested/deleted)')
        .action(addToWhitelistCommand);

    program
        .command('remove-from-whitelist')
        .description('Remove a preference pattern from the whitelist')
        .action(removeFromWhitelistCommand);

    program
        .command('list-whitelist')
        .description('Show all whitelisted preference patterns')
        .action(listWhitelistCommand);
}

// ============================================================================
// ADD TO WHITELIST
// ============================================================================

async function addToWhitelistCommand() {
    const typeAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'type',
        message: 'What type of whitelist entry?',
        choices: [
            { name: 'Exact match (single preference ID)', value: 'exact' },
            { name: 'Wildcard pattern (e.g., c_test*)', value: 'wildcard' },
            { name: 'Regex pattern (e.g., c_(test|pilot).*)', value: 'regex' }
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
            message: 'Reason for whitelisting (optional):',
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

    const added = addToWhitelist(entry);

    if (added) {
        const display = entry.id || entry.pattern;
        console.log(`${LOG_PREFIX.INFO} Added to whitelist: ${display} (${typeAnswer.type})`);
        if (answers.reason) {
            console.log(`  Reason: ${answers.reason}`);
        }
    } else {
        console.log(`${LOG_PREFIX.WARNING} Entry already exists in whitelist`);
    }
}

// ============================================================================
// REMOVE FROM WHITELIST
// ============================================================================

async function removeFromWhitelistCommand() {
    const entries = listWhitelist();

    if (entries.length === 0) {
        console.log('Whitelist is empty — nothing to remove.');
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
        message: `Remove "${selected}" from whitelist?`,
        default: true
    }]);

    if (!confirm) {
        console.log('Removal cancelled.');
        return;
    }

    const removed = removeFromWhitelist(selected);

    if (removed) {
        console.log(`${LOG_PREFIX.INFO} Removed from whitelist: ${selected}`);
    } else {
        console.log(`${LOG_PREFIX.ERROR} Entry not found in whitelist`);
    }
}

// ============================================================================
// LIST WHITELIST
// ============================================================================

function listWhitelistCommand() {
    const entries = listWhitelist();

    if (entries.length === 0) {
        console.log('Whitelist is empty. All preferences are eligible for analysis.');
        console.log('Use "add-to-whitelist" to restrict analysis to specific preferences.\n');
        return;
    }

    console.log('\n================================================================================');
    console.log('PREFERENCE WHITELIST');
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
