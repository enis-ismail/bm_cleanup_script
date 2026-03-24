/**
 * Setup Demo Scenario
 * Creates test attributes on selected development realms, sets up whitelist,
 * and places fake meta/code artifacts in a sibling repo for analysis discovery.
 */

import inquirer from 'inquirer';
import path from 'path';
import { startTimer } from '../../../helpers/timer.js';
import { LOG_PREFIX, SEPARATOR } from '../../../config/constants.js';
import { getRealmsByInstanceType } from '../../../config/helpers/helpers.js';
import { getSiblingRepositories } from '../../../io/util.js';
import { findCartridgeFolders } from '../../../io/util.js';
import {
    writeDemoBackups,
    restoreDemoAttributes,
    replaceDemoWhitelist,
    writeDemoMetaFile,
    writeDemoCodeReference,
    saveScenarioState,
    loadScenarioState,
    getDemoAttributeIds
} from '../helpers/demoScenarioHelper.js';

// ============================================================================
// SETUP DEMO COMMAND
// ============================================================================

/**
 * Interactive setup command that creates a full demo scenario.
 */
export async function setupDemo() {
    const timer = startTimer();
    console.log(`\n${SEPARATOR}`);
    console.log('DEMO SCENARIO SETUP');
    console.log(`${SEPARATOR}\n`);

    // Check for existing scenario
    const existingState = loadScenarioState();
    if (existingState) {
        console.log(`${LOG_PREFIX.WARNING} An existing demo scenario was found (created ${existingState.createdAt}).`);
        console.log('  Run teardown-demo first to clean up before setting up a new scenario.\n');
        const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Continue anyway? (previous state will be overwritten)',
            default: false
        }]);
        if (!proceed) {
            console.log('Setup cancelled.');
            return;
        }
    }

    // --- STEP 1: Select instance type and realms ---
    console.log('--- STEP 1: Select realms ---\n');

    const { instanceType } = await inquirer.prompt([{
        name: 'instanceType',
        message: 'Instance type for demo:',
        type: 'rawlist',
        choices: ['development', 'sandbox', 'staging'],
        default: 'development'
    }]);

    const availableRealms = getRealmsByInstanceType(instanceType);
    if (!availableRealms || availableRealms.length === 0) {
        console.log(`${LOG_PREFIX.ERROR} No realms configured for instance type: ${instanceType}`);
        return;
    }

    const { realms } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'realms',
        message: 'Select realms to set up demo on:',
        choices: availableRealms,
        default: availableRealms,
        validate: (input) => input.length > 0 ? true : 'Select at least one realm'
    }]);

    // --- STEP 2: Select sibling repository ---
    console.log('\n--- STEP 2: Select sibling repository ---\n');

    const siblings = await getSiblingRepositories();
    if (siblings.length === 0) {
        console.log(`${LOG_PREFIX.ERROR} No sibling repositories found.`);
        return;
    }

    const { repository } = await inquirer.prompt([{
        type: 'rawlist',
        name: 'repository',
        message: 'Select SFCC repository for meta/code artifacts:',
        choices: siblings
    }]);

    const repoPath = path.join(path.dirname(process.cwd()), repository);

    // --- STEP 3: Select cartridge for code reference ---
    console.log('\n--- STEP 3: Select cartridge for code reference ---\n');

    const cartridges = findCartridgeFolders(repoPath);
    if (cartridges.length === 0) {
        console.log(`${LOG_PREFIX.ERROR} No cartridges found in ${repository}.`);
        return;
    }

    const { cartridgeName } = await inquirer.prompt([{
        type: 'rawlist',
        name: 'cartridgeName',
        message: 'Select cartridge for simulated code reference:',
        choices: cartridges
    }]);

    // --- STEP 4: Select realm for code usage simulation ---
    console.log('\n--- STEP 4: Select realm for code usage ---\n');

    const { realmForUsage } = await inquirer.prompt([{
        type: 'rawlist',
        name: 'realmForUsage',
        message: 'Which realm\'s attribute should appear "used" in code?',
        choices: realms,
        default: realms[0]
    }]);

    // --- Confirmation ---
    console.log(`\n${SEPARATOR}`);
    console.log('SETUP SUMMARY');
    console.log(`${SEPARATOR}`);
    console.log(`  Instance type:    ${instanceType}`);
    console.log(`  Realms:           ${realms.join(', ')}`);
    console.log(`  Repository:       ${repository}`);
    console.log(`  Cartridge:        ${cartridgeName}`);
    console.log(`  Code usage realm: ${realmForUsage}`);
    console.log(`  Attributes:       ${getDemoAttributeIds(realms).join(', ')}`);
    console.log('');

    const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Proceed with demo setup?',
        default: true
    }]);

    if (!confirm) {
        console.log('Setup cancelled.');
        return;
    }

    // --- Execute setup ---
    console.log(`\n${SEPARATOR}`);
    console.log('EXECUTING SETUP');
    console.log(`${SEPARATOR}\n`);

    // Step A: Write backup files
    console.log('Step A: Generating demo backup files...\n');
    const backupPaths = writeDemoBackups(realms, instanceType);

    // Step B: Restore (push) attributes to realms
    console.log('\nStep B: Pushing demo attributes to realms...\n');
    const { totalRestored, totalFailed } = await restoreDemoAttributes(backupPaths, instanceType);
    console.log(`\n  Total restored: ${totalRestored}, failed: ${totalFailed}`);

    if (totalFailed > 0) {
        console.log(`\n${LOG_PREFIX.WARNING} Some attributes failed to restore. Continuing with remaining steps.`);
    }

    // Step C: Replace whitelist
    console.log('\nStep C: Replacing whitelist with demo entries...\n');
    const previousWhitelist = replaceDemoWhitelist(realms);

    // Step D: Write meta XML
    console.log('\nStep D: Creating demo meta XML in sibling repo...\n');
    const metaFilePath = writeDemoMetaFile(repoPath, realms);

    // Step E: Write code reference
    console.log('\nStep E: Creating demo code reference in sibling repo...\n');
    const codeFilePath = writeDemoCodeReference(repoPath, cartridgeName, realmForUsage);

    // Step F: Save scenario state
    console.log('\nStep F: Saving scenario state for teardown...\n');
    const attributeIds = getDemoAttributeIds(realms);
    saveScenarioState({
        instanceType,
        realms,
        repoPath,
        cartridgeName,
        realmForUsage,
        backupPaths,
        previousWhitelist,
        metaFilePath,
        codeFilePath,
        attributeIds
    });

    // --- Done ---
    console.log(`\n${SEPARATOR}`);
    console.log('DEMO SETUP COMPLETE');
    console.log(`${SEPARATOR}`);
    console.log(`\n  ${totalRestored} attributes pushed across ${realms.length} realm(s)`);
    console.log(`  Whitelist set to ${attributeIds.length} demo entries`);
    console.log(`  Meta XML placed in: ${metaFilePath}`);
    console.log(`  Code reference in:  ${codeFilePath}`);
    console.log('\n  You can now run analyze-preferences, detect-orphans, etc.');
    console.log('  When done, run teardown-demo to clean up.\n');
    console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
}
