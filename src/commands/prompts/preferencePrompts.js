import inquirer from 'inquirer';
import { IDENTIFIERS, LOG_PREFIX, BACKUP_CONFIG } from '../../config/constants.js';
import { logSectionTitle } from '../../scripts/loggingScript/log.js';
import { checkBackupStatusForRealms } from '../../io/backupUtils.js';

export const objectTypePrompt = (defaultValue = IDENTIFIERS.SITE_PREFERENCES) => ([
    {
        name: 'objectType',
        message: 'Choose an object type?',
        type: 'rawlist',
        choices: [IDENTIFIERS.SITE_PREFERENCES],
        default: defaultValue
    }
]);

export const scopePrompts = () => ([
    {
        name: 'scope',
        message: 'Run for all sites or single site?',
        type: 'rawlist',
        choices: ['all', 'single'],
        default: 'all'
    },
    {
        name: 'siteId',
        message: 'Enter site ID to process',
        when: (a) => a.scope === 'single',
        validate: (input) => input && input.trim().length > 0 ? true : 'Site ID is required'
    }
]);

export const includeDefaultsPrompt = () => ([
    {
        type: 'confirm',
        name: 'includeDefaults',
        message: 'Include default values? (slower)',
        default: true
    }
]);

export const preferenceIdPrompt = () => ([
    {
        name: 'preferenceId',
        message: 'Preference ID to search for?',
        validate: (input) => input && input.trim().length > 0 ? true : 'Preference ID is required'
    }
]);

export const confirmPreferenceDeletionPrompt = (count) => ([
    {
        name: 'confirm',
        message: `Are you sure you want to delete these ${count} preferences? This action cannot be undone.`,
        type: 'confirm',
        default: false
    }
]);

export const runAnalyzePreferencesPrompt = (instanceType) => ([
    {
        name: 'runAnalyze',
        message: `Preferences for deletion file hasn't been generated yet for '${instanceType}'.
            Would you like to run analyze-preferences to generate this file?`,
        type: 'confirm',
        default: true
    }
]);

export const useExistingBackupPrompt = (ageInDays) => ([
    {
        name: 'useExisting',
        message: `Backup file found (${ageInDays} day${ageInDays === 1 ? '' : 's'} old). Use existing backup data?`,
        type: 'confirm',
        default: true
    }
]);

export const useExistingBackupsForAllRealmsPrompt = (backupSummary) => ([
    {
        name: 'useExisting',
        message: `Found backup files for ${backupSummary.availableCount} realm(s).`
            + ' Use cached data for all realms?',
        type: 'confirm',
        default: true
    }
]);

/**
 * Prompt user about using cached backup files when includeDefaults is true.
 * Checks backup age, displays status, and asks whether to reuse or fetch fresh.
 * @param {string[]} realmsToProcess - Realms being processed
 * @param {string} objectType - Object type
 * @returns {Promise<boolean>} Whether to use cached backups
 */
export async function promptBackupCachePreference(realmsToProcess, objectType) {
    const backupStatus = await checkBackupStatusForRealms(realmsToProcess, objectType);
    const validBackups = backupStatus.filter(b => b.exists && !b.tooOld);
    const tooOldBackups = backupStatus.filter(b => b.exists && b.tooOld);

    if (validBackups.length === 0) {
        return false;
    }

    logSectionTitle('BACKUP FILES FOUND');

    validBackups.forEach(backup => {
        const plural = backup.ageInDays === 1 ? '' : 's';
        console.log(
            `  ${LOG_PREFIX.INFO} ${backup.realm}: ${backup.ageInDays} day${plural} old`
        );
    });

    if (tooOldBackups.length > 0) {
        console.log(
            `\nBackups older than ${BACKUP_CONFIG.MAX_AGE_DAYS} days (will fetch fresh):`
        );
        tooOldBackups.forEach(backup => {
            console.log(
                `  ${LOG_PREFIX.WARNING} ${backup.realm}: ${backup.ageInDays} days old`
            );
        });
    }

    console.log('');

    const backupAnswer = await inquirer.prompt(useExistingBackupsForAllRealmsPrompt({
        availableCount: validBackups.length,
        totalCount: realmsToProcess.length
    }));

    if (backupAnswer.useExisting) {
        console.log(`${LOG_PREFIX.INFO} Will use cached backups where available.\n`);
    } else {
        console.log(`${LOG_PREFIX.INFO} Will fetch fresh data for all realms.\n`);
    }

    return backupAnswer.useExisting;
}
