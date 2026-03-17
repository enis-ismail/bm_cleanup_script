import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import {
    getAvailableRealms,
    getInstanceType
} from '../../../config/helpers/helpers.js';
import { startTimer } from '../../../helpers/timer.js';
import * as prompts from '../../prompts/index.js';
import { LOG_PREFIX, IDENTIFIERS } from '../../../config/constants.js';
import {
    logSectionTitle,
    logRuntime,
    logRestoreSummary
} from '../../../scripts/loggingScript/log.js';
import { findLatestBackupFile } from '../helpers/backupHelpers.js';
import { restorePreferencesForRealm } from '../helpers/restoreHelper.js';
import { loadAndValidateBackup } from './shared.js';

// ============================================================================
// RESTORE PREFERENCES
// Standalone restore from backup file
// ============================================================================

export async function restorePreferences() {
    const timer = startTimer();
    logSectionTitle('Restore Preferences from Backup');

    const availableRealms = getAvailableRealms();
    if (availableRealms.length === 0) {
        console.log(`${LOG_PREFIX.WARNING} No realms configured. Run "add-realm" first.\n`);
        return;
    }

    const realmAnswers = await inquirer.prompt(prompts.realmPrompt());
    const realm = realmAnswers.realm;
    const objectType = IDENTIFIERS.SITE_PREFERENCES;
    const instanceType = getInstanceType(realm);

    console.log(`\nLooking for latest backup for realm: ${realm}\n`);

    const backupFilePath = findLatestBackupFile(realm, objectType);
    if (!backupFilePath || !fs.existsSync(backupFilePath)) {
        console.log(`${LOG_PREFIX.WARNING} No backup file found for realm: ${realm}`);
        console.log(
            `   Expected location: backup/${instanceType}/${realm}_${objectType}_backup_*.json\n`
        );
        logRuntime(timer);
        return;
    }

    console.log(`${LOG_PREFIX.INFO} Found backup: ${path.basename(backupFilePath)}\n`);

    const confirmAnswers = await inquirer.prompt(prompts.confirmProceedRestorePrompt());

    if (!confirmAnswers.proceed) {
        console.log(`\n${LOG_PREFIX.INFO} Restore cancelled.\n`);
        logRuntime(timer);
        return;
    }

    console.log('\nRestoring preferences from backup...\n');

    const backup = await loadAndValidateBackup(backupFilePath);
    if (!backup) {
        return;
    }

    const preferences = backup.attributes.map(attr => attr.id);
    const result = await restorePreferencesForRealm({
        preferenceIds: preferences, backup, objectType, instanceType, realm
    });

    logRestoreSummary({ restored: result.restored, failed: result.failed, realm });
    logRuntime(timer);
}
