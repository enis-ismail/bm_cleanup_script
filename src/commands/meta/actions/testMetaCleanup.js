import inquirer from 'inquirer';
import { startTimer } from '../../../helpers/timer.js';
import {
    resolveRealmScopeSelection,
    deletionLevelPrompt,
    deletionSourcePrompt,
    confirmExecutionPrompt
} from '../../prompts/index.js';
import {
    buildMetaCleanupPlan,
    executeMetaCleanupPlan,
    formatCleanupPlan,
    formatExecutionResults,
    removePreferenceValuesFromSites,
    formatPreferenceValueResults
} from '../helpers/metaFileCleanup.js';
import { getInstanceType, getRealmsByInstanceType } from '../../../config/helpers/helpers.js';
import { promptForRepositoryPath, loadDeletionCandidates, runCrossRealmScanIfNeeded } from './shared.js';

// ============================================================================
// TEST META CLEANUP
// Preview/execute removal of preference definitions from repository XML
// ============================================================================

/**
 * @param {Object} options - Command options
 * @param {boolean} [options.execute] - If true, modify files; otherwise dry-run
 */
export async function testMetaCleanup(options) {
    const timer = startTimer();
    const dryRun = !options.execute;

    console.log(`\n${'═'.repeat(80)}`);
    console.log(' META FILE CLEANUP');
    console.log(`${'═'.repeat(80)}`);
    console.log(`  Mode: ${dryRun ? 'DRY-RUN (no files will be changed)' : '⚠  LIVE — files will be modified'}`);
    console.log('');

    // --- STEP 1: Select sibling repository ---
    const repoPath = await promptForRepositoryPath();
    if (!repoPath) {
        return;
    }

    // --- STEP 2: Select realms ---
    const { realmList, instanceTypeOverride } = await resolveRealmScopeSelection(
        (questions) => inquirer.prompt(questions)
    );

    if (!realmList || realmList.length === 0) {
        console.log('No realms selected.');
        return;
    }

    const instanceType = instanceTypeOverride || getInstanceType(realmList[0]);
    console.log(`\n  Realms: ${realmList.join(', ')}`);
    console.log(`  Instance type: ${instanceType}`);
    console.log(`  Repository: ${repoPath}\n`);

    // --- STEP 3: Select deletion tier ---
    const tierAnswers = await inquirer.prompt(deletionLevelPrompt());
    const maxTier = tierAnswers.deletionLevel;

    // --- STEP 4: Select deletion source (per-realm vs cross-realm) ---
    const { deletionSource } = await inquirer.prompt(deletionSourcePrompt());
    const useCrossRealm = deletionSource === 'cross-realm';

    console.log(
        `\n  Source: ${useCrossRealm ? 'Cross-realm intersection' : 'Per-realm files'}`
    );

    // --- STEP 5: Load deletion files ---
    const { realmPreferenceMap, selectedPreferenceIds, totalPrefs } = loadDeletionCandidates({
        realmList, instanceType, maxTier, useCrossRealm
    });

    if (totalPrefs === 0) {
        console.log('\n  No preferences to process. Run analyze-preferences first.');
        return;
    }

    // --- STEP 6: Build cleanup plan ---
    console.log('\n  Building meta file cleanup plan...');
    const allInstanceRealms = getRealmsByInstanceType(instanceType);
    const plan = buildMetaCleanupPlan(
        repoPath, realmPreferenceMap, allInstanceRealms, { crossRealm: useCrossRealm }
    );

    // --- STEP 7: Display the plan ---
    console.log(formatCleanupPlan(plan));

    if (plan.actions.length === 0) {
        console.log('  No meta file changes needed.');
        runCrossRealmScanIfNeeded({ useCrossRealm, repoPath, selectedPreferenceIds });
        const elapsed = timer.stop();
        console.log(`\n  Completed in ${elapsed}\n`);
        return;
    }

    // --- STEP 8: Confirm and execute ---
    const { confirm } = await inquirer.prompt(
        confirmExecutionPrompt({ actionCount: plan.actions.length, dryRun })
    );

    if (!confirm) {
        console.log('\n  Aborted.\n');
        return;
    }

    console.log('');
    const results = executeMetaCleanupPlan(plan, { dryRun });
    console.log(formatExecutionResults(results));

    // Remove orphaned preference values from preferences.xml files
    console.log('\n  Cleaning preference values from preferences.xml files...');
    const prefValueResults = removePreferenceValuesFromSites({
        repoPath,
        preferenceIds: selectedPreferenceIds,
        dryRun
    });
    console.log(formatPreferenceValueResults(prefValueResults));

    runCrossRealmScanIfNeeded({ useCrossRealm, repoPath, selectedPreferenceIds });

    const elapsed = timer.stop();
    console.log(`  Completed in ${elapsed}\n`);
}
