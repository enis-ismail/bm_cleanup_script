import inquirer from 'inquirer';
import path from 'path';
import { getSiblingRepositories } from '../../../io/util.js';
import { repositoryPrompt } from '../../prompts/index.js';

// ============================================================================
// SHARED HELPERS
// Functions shared across multiple cartridge action files
// ============================================================================

/**
 * Prompt user to select a sibling repository and return the resolved path.
 * @returns {Promise<string|null>} Resolved repository path, or null if none found
 */
export async function promptForRepositoryPath() {
    const siblings = await getSiblingRepositories();
    if (siblings.length === 0) {
        console.log('No sibling repositories found.');
        return null;
    }

    const answers = await inquirer.prompt(await repositoryPrompt(siblings));
    return path.join(path.dirname(process.cwd()), answers.repository);
}
