/**
 * Teardown Demo Scenario
 * Reverses all changes made by setup-demo: deletes attributes from realms,
 * restores the original whitelist, and removes fake meta/code artifacts.
 */

import inquirer from 'inquirer';
import { startTimer } from '../../../helpers/timer.js';
import { LOG_PREFIX, SEPARATOR } from '../../../config/constants.js';
import {
    loadScenarioState,
    removeScenarioState,
    deleteDemoAttributes,
    removeDemoArtifacts,
    removeDemoBackups,
    restorePreviousWhitelist
} from '../helpers/demoScenarioHelper.js';

// ============================================================================
// TEARDOWN DEMO COMMAND
// ============================================================================

/**
 * Interactive teardown command that reverses the demo scenario.
 */
export async function teardownDemo() {
    const timer = startTimer();
    console.log(`\n${SEPARATOR}`);
    console.log('DEMO SCENARIO TEARDOWN');
    console.log(`${SEPARATOR}\n`);

    // Load saved state
    const state = loadScenarioState();
    if (!state) {
        console.log(`${LOG_PREFIX.ERROR} No demo scenario state found.`);
        console.log('  Run setup-demo first to create a demo scenario.\n');
        return;
    }

    // Show summary of what will be cleaned up
    console.log('Saved scenario state:');
    console.log(`  Created at:       ${state.createdAt}`);
    console.log(`  Instance type:    ${state.instanceType}`);
    console.log(`  Realms:           ${state.realms.join(', ')}`);
    console.log(`  Repository:       ${state.repoPath}`);
    console.log(`  Meta file:        ${state.metaFilePath}`);
    console.log(`  Code reference:   ${state.codeFilePath}`);
    console.log(`  Attributes:       ${state.attributeIds.join(', ')}`);
    console.log('');

    const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Proceed with teardown? This will delete demo attributes from all realms.',
        default: true
    }]);

    if (!confirm) {
        console.log('Teardown cancelled.');
        return;
    }

    console.log(`\n${SEPARATOR}`);
    console.log('EXECUTING TEARDOWN');
    console.log(`${SEPARATOR}\n`);

    // Step 1: Delete demo attributes from realms
    console.log('Step 1: Deleting demo attributes from realms...\n');
    const { totalDeleted, totalFailed } = await deleteDemoAttributes(state);
    console.log(`\n  Total deleted: ${totalDeleted}, failed: ${totalFailed}`);

    // Step 2: Restore original whitelist
    console.log('\nStep 2: Restoring original whitelist...\n');
    restorePreviousWhitelist(state.previousWhitelist);

    // Step 3: Remove repo artifacts (meta XML + code reference)
    console.log('\nStep 3: Removing demo artifacts from sibling repo...\n');
    const { metaRemoved, codeRemoved } = removeDemoArtifacts(state);

    // Step 4: Remove generated backup files
    console.log('\nStep 4: Removing demo backup files...\n');
    removeDemoBackups(state);

    // Step 5: Remove scenario state file
    console.log('\nStep 5: Removing scenario state...\n');
    removeScenarioState();

    // --- Done ---
    console.log(`\n${SEPARATOR}`);
    console.log('DEMO TEARDOWN COMPLETE');
    console.log(`${SEPARATOR}`);
    console.log(`\n  Attributes deleted: ${totalDeleted} (failed: ${totalFailed})`);
    console.log(`  Whitelist restored: ${LOG_PREFIX.INFO}`);
    console.log(`  Meta XML removed:   ${metaRemoved ? LOG_PREFIX.INFO : LOG_PREFIX.WARNING}`);
    console.log(`  Code ref removed:   ${codeRemoved ? LOG_PREFIX.INFO : LOG_PREFIX.WARNING}`);
    console.log('');
    console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
}
