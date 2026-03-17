import inquirer from 'inquirer';
import path from 'path';
import { startTimer } from '../../../helpers/timer.js';
import { findAllMatrixFiles, getSiblingRepositories } from '../../../io/util.js';
import { getActivePreferencesFromMatrices, findPreferenceUsage } from '../../../io/codeScanner.js';
import { repositoryPrompt, preferenceIdPrompt } from '../../prompts/index.js';

// ============================================================================
// TEST ACTIVE PREFERENCES
// Display all active preferences from matrix files
// ============================================================================

/**
 * Display all active preferences from matrix files.
 */
export async function testActivePreferences() {
    const matrixFiles = findAllMatrixFiles();

    if (matrixFiles.length === 0) {
        console.log('No matrix files found.');
        return;
    }

    console.log(`Found ${matrixFiles.length} matrix file(s)\n`);

    const matrixFilePaths = matrixFiles.map(f => f.matrixFile);
    const activePreferences = Array.from(getActivePreferencesFromMatrices(matrixFilePaths)).sort();
    const count = activePreferences.length;

    console.log(`Active Preferences (${count}):\n`);
    activePreferences.forEach((pref) => {
        console.log(`  • ${pref}`);
    });
}

// ============================================================================
// FIND PREFERENCE USAGE
// Find cartridges using a specific preference ID
// ============================================================================

/**
 * Find cartridges using a specific preference ID.
 */
export async function findPreferenceUsageCommand() {
    const timer = startTimer();
    const siblings = await getSiblingRepositories();

    if (siblings.length === 0) {
        console.log('No sibling repositories found.');
        return;
    }

    const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
    const targetPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

    const preferenceAnswers = await inquirer.prompt(preferenceIdPrompt());
    const result = await findPreferenceUsage(
        preferenceAnswers.preferenceId,
        targetPath
    );

    const { preferenceId, repositoryPath, deprecatedCartridgesCount, totalMatches, cartridges } = result;

    console.log(`\nPreference ID: ${preferenceId}`);
    console.log(`Repository: ${repositoryPath}`);
    console.log(`Deprecated cartridges filtered: ${deprecatedCartridgesCount}`);
    console.log(`Matches found: ${totalMatches}`);
    console.log(`\nCartridges using this preference (${cartridges.length}):`);

    if (cartridges.length === 0) {
        console.log('No cartridges found.');
    } else {
        cartridges.forEach((cartridge) => {
            console.log(`  • ${cartridge}`);
        });
    }

    console.log(`\n✓ Total runtime: ${timer.stop()}`);
}
