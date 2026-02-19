import inquirer from 'inquirer';
import {
    addRealmToConfig,
    removeRealmFromConfig,
    getAvailableRealms
} from '../../helpers.js';
import {
    addRealmPrompts,
    selectRealmToRemovePrompt,
    confirmRealmRemovalPrompt
} from '../prompts/realmPrompts.js';

/**
 * Register setup/configuration commands
 * @param {Command} program - Commander.js program instance
 */
export function registerSetupCommands(program) {
    program
        .command('add-realm')
        .description('Add a new realm to config.json')
        .action(async () => {
            const answers = await inquirer.prompt(addRealmPrompts());
            const { name, hostname, clientId, clientSecret, siteTemplatesPath, instanceType } = answers;
            addRealmToConfig(name, hostname, clientId, clientSecret, siteTemplatesPath, instanceType);
        });

    program
        .command('remove-realm')
        .description('Remove a realm from config.json')
        .action(async () => {
            const realms = getAvailableRealms();
            if (realms.length === 0) {
                console.log('No realms available to remove.');
                return;
            }

            const selectAnswer = await inquirer.prompt(selectRealmToRemovePrompt(realms));
            const confirmAnswer = await inquirer.prompt(
                confirmRealmRemovalPrompt(selectAnswer.realmToRemove)
            );

            if (confirmAnswer.confirm) {
                await removeRealmFromConfig(selectAnswer.realmToRemove);
            } else {
                console.log('Realm removal cancelled.');
            }
        });
}
