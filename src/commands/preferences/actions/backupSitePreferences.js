import inquirer from 'inquirer';
import { getInstanceType } from '../../../config/helpers/helpers.js';
import { startTimer } from '../../../helpers/timer.js';
import * as prompts from '../../prompts/index.js';
import { logRuntime } from '../../../scripts/loggingScript/log.js';
import { refreshMetadataBackupForRealm } from '../../../helpers/backupJob.js';

// ============================================================================
// BACKUP SITE PREFERENCES
// Trigger backup job and download metadata via WebDAV
// ============================================================================

export async function backupSitePreferences() {
    const timer = startTimer();
    const realmAnswers = await inquirer.prompt(prompts.realmPrompt());
    const realm = realmAnswers.realm;
    const instanceType = getInstanceType(realm);

    console.log('Triggering backup job and downloading metadata...');
    const refreshResult = await refreshMetadataBackupForRealm(
        realm,
        instanceType,
        { forceJobExecution: true }
    );

    if (!refreshResult.ok) {
        console.log(`Failed to refresh metadata: ${refreshResult.reason}`);
        return;
    }

    console.log(`Backup downloaded to: ${refreshResult.filePath}`);
    logRuntime(timer);
}
