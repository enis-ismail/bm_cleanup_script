import inquirer from 'inquirer';
import { LOG_PREFIX } from '../../../config/constants.js';
import * as prompts from '../../prompts/index.js';
import { loadBackupFile } from '../../../io/backupUtils.js';
import { validateAndCorrectBackup } from '../helpers/backupHelpers.js';

// ============================================================================
// SHARED ACTION UTILITIES
// Functions shared across multiple preference command actions
// ============================================================================

/**
 * Load a backup file and run validation with user-prompted corrections.
 * @param {string} backupFilePath - Path to backup JSON file
 * @returns {Promise<Object|null>} Validated backup object or null on failure
 */
export async function loadAndValidateBackup(backupFilePath) {
    console.log('Loading backup file...');
    let backup = await loadBackupFile(backupFilePath);
    console.log(`${LOG_PREFIX.INFO} Loaded ${backup.attributes.length} preference(s)\n`);

    console.log('Validating backup structure...');
    const validation = validateAndCorrectBackup(backup);

    if (validation.corrected) {
        console.log(`${LOG_PREFIX.WARNING} Found issues in backup file:\n`);
        validation.corrections.forEach(msg => console.log(msg));

        const correctAnswers = await inquirer.prompt(prompts.applyBackupCorrectionsPrompt());

        if (correctAnswers.applyCorrections) {
            backup = validation.backup;
            console.log(`\n${LOG_PREFIX.INFO} Corrections applied to backup\n`);
        } else {
            console.log(
                `\n${LOG_PREFIX.WARNING} Proceeding with original backup (may cause errors).\n`
            );
        }
    } else {
        console.log(`${LOG_PREFIX.INFO} Backup structure is valid\n`);
    }

    return backup;
}
