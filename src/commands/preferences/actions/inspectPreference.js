import inquirer from 'inquirer';
import { getInstanceType } from '../../../config/helpers/helpers.js';
import { startTimer } from '../../../helpers/timer.js';
import { openFileInVSCode } from '../../../io/util.js';
import * as prompts from '../../prompts/index.js';
import { LOG_PREFIX } from '../../../config/constants.js';
import { logSectionTitle, logRuntime } from '../../../scripts/loggingScript/log.js';
import { buildInspectionReport, writeInspectionReport } from '../helpers/inspectHelper.js';

// ============================================================================
// INSPECT PREFERENCE
// Display all pre-generated data for a single preference across realms
// ============================================================================

export async function inspectPreference() {
    const timer = startTimer();

    // --- STEP 1: Get preference ID & scope ---
    logSectionTitle('STEP 1: Select Preference & Scope');

    const { preferenceId } = await inquirer.prompt(prompts.preferenceIdPrompt());

    const selection = await prompts.resolveRealmScopeSelection(inquirer.prompt);
    const realms = selection.realmList;
    const instanceType = selection.instanceTypeOverride
        || getInstanceType(realms[0]);

    // --- STEP 2: Build report from results files ---
    logSectionTitle('STEP 2: Building Inspection Report');

    const report = buildInspectionReport({
        preferenceId,
        instanceType,
        realms
    });

    const outputPath = writeInspectionReport(report, instanceType);

    console.log(`\n${LOG_PREFIX.INFO} Report saved to: ${outputPath}`);

    try {
        await openFileInVSCode(outputPath);
    } catch {
        // VS Code may not be available in all environments
    }

    logRuntime(timer);
}
