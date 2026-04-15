import { analyzePreferences } from './actions/analyzePreferences.js';
import { removePreferences } from './actions/removePreferences.js';
import { restorePreferences } from './actions/restorePreferences.js';
import { backupSitePreferences } from './actions/backupSitePreferences.js';
import { inspectPreference } from './actions/inspectPreference.js';
import { inspectPreferenceGroup } from './actions/inspectPreferenceGroup.js';
import { exportTicketLists } from './actions/exportTicketLists.js';

// ============================================================================
// PREFERENCE COMMANDS REGISTRATION
// Register all preference-related commands with the CLI program
// ============================================================================

export function registerPreferenceCommands(program) {
    program
        .command('analyze-preferences')
        .description('Full preference analysis workflow: fetch -> summarize -> check')
        .action(analyzePreferences);

    program
        .command('remove-preferences')
        .description('Remove preferences marked for deletion from site preferences')
        .option('--dry-run', 'Simulate deletion without making any changes')
        .action(removePreferences);

    program
        .command('restore-preferences')
        .description('Restore site preferences from backup file')
        .action(restorePreferences);

    program
        .command('backup-site-preferences')
        .description('Trigger site preferences backup job and download the ZIP from WebDAV')
        .action(backupSitePreferences);

    program
        .command('inspect-preference')
        .description('Show detailed info about a single preference (values, code refs, P-level)')
        .action(inspectPreference);

    program
        .command('inspect-preference-group')
        .description('Show detailed info for every preference in a selected preference group')
        .action(inspectPreferenceGroup);

    program
        .command('export-ticket-lists')
        .description('Export per-realm, per-P-level preference lists as Jira ticket attachments')
        .action(exportTicketLists);
}
