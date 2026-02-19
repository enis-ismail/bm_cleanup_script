export const objectTypePrompt = (defaultValue = 'SitePreferences') => ([
    {
        name: 'objectType',
        message: 'Choose an object type?',
        type: 'rawlist',
        choices: ['SitePreferences'],
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
        message: `Found backup files for ${backupSummary.availableCount} realm(s). Use cached data for all realms?`,
        type: 'confirm',
        default: true
    }
]);
