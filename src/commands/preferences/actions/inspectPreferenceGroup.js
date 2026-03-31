import inquirer from 'inquirer';
import { getInstanceType } from '../../../config/helpers/helpers.js';
import { startTimer } from '../../../helpers/timer.js';
import { openFileInVSCode } from '../../../io/util.js';
import * as prompts from '../../prompts/index.js';
import { LOG_PREFIX } from '../../../config/constants.js';
import { logSectionTitle, logRuntime } from '../../../scripts/loggingScript/log.js';
import {
    buildPreferenceGroupInspectionReport,
    getInspectablePreferenceGroupIds,
    writePreferenceGroupInspectionReport
} from '../helpers/inspectHelper.js';

// ============================================================================
// INSPECT PREFERENCE GROUP
// Display all pre-generated data for every preference in a selected group
// ============================================================================

/**
 * Build a report for all preferences in a selected preference group.
 * @returns {Promise<void>} Resolves when the report has been written
 */
export async function inspectPreferenceGroup() {
    const timer = startTimer();

    // --- STEP 1: Select scope ---
    logSectionTitle('STEP 1: Select Scope');

    const selection = await prompts.resolveRealmScopeSelection(inquirer.prompt);
    const realms = selection.realmList;
    const instanceType = selection.instanceTypeOverride
        || getInstanceType(realms[0]);

    // --- STEP 2: Select preference group ---
    logSectionTitle('STEP 2: Select Preference Group');

    const groupIds = getInspectablePreferenceGroupIds(realms);
    if (groupIds.length === 0) {
        console.log(
            `\n${LOG_PREFIX.WARNING} No preference groups found in results files for the selected realms.`
        );
        console.log(
            `${LOG_PREFIX.INFO} Run analyze-preferences first so usage CSV files are available.`
        );
        logRuntime(timer);
        return;
    }

    const { groupId } = await inquirer.prompt(prompts.groupIdPrompt(groupIds));

    // --- STEP 3: Build report from results files ---
    logSectionTitle('STEP 3: Building Group Inspection Report');

    const report = buildPreferenceGroupInspectionReport({
        groupId,
        instanceType,
        realms
    });

    const outputPath = writePreferenceGroupInspectionReport(
        report,
        instanceType,
        groupId
    );

    console.log(`\n${LOG_PREFIX.INFO} Report saved to: ${outputPath}`);

    try {
        await openFileInVSCode(outputPath);
    } catch {
        // VS Code may not be available in all environments
    }

    logRuntime(timer);
}