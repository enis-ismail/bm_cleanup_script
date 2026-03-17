import inquirer from 'inquirer';
import { startTimer } from '../../../helpers/timer.js';
import { instanceTypePrompt } from '../../prompts/index.js';
import { getRealmsByInstanceType } from '../../../config/helpers/helpers.js';
import { getMetadataBackupPathForRealm } from '../../../helpers/backupJob.js';

// ============================================================================
// TEST GENERATE BACKUP JSON
// Generate SitePreferences backup JSON from unused preferences list and usage CSV
// ============================================================================

/**
 * Generate SitePreferences backup JSON from unused preferences list and usage CSV.
 */
export async function testGenerateBackupJson() {
    const timer = startTimer();

    console.log('\n📋 STEP 1: Select Instance Type\n');

    const instanceTypeAnswers = await inquirer.prompt(instanceTypePrompt('sandbox'));
    const { instanceType } = instanceTypeAnswers;

    console.log('\n📋 STEP 2: Select Realms to Process\n');

    const realmsForInstance = getRealmsByInstanceType(instanceType);
    if (!realmsForInstance || realmsForInstance.length === 0) {
        console.log(`No realms found for instance type: ${instanceType}`);
        console.log(`✓ Total runtime: ${timer.stop()}`);
        return;
    }

    const realmSelection = await inquirer.prompt([
        {
            name: 'realms',
            message: 'Select realms to process:',
            type: 'checkbox',
            choices: realmsForInstance,
            default: realmsForInstance
        }
    ]);

    const realmsToProcess = realmSelection.realms;
    if (!realmsToProcess || realmsToProcess.length === 0) {
        console.log('No realms selected.');
        console.log(`✓ Total runtime: ${timer.stop()}`);
        return;
    }

    console.log('\n📋 STEP 3: Generate Backup JSON from CSV\n');

    // Import the generation script
    const { generate } = await import('../helpers/generateSitePreferencesJSON.js');

    // Process each realm
    for (const realm of realmsToProcess) {
        console.log('\n================================================================================');
        console.log(`Realm: ${realm}`);
        console.log(`Instance type: ${instanceType}`);
        console.log('================================================================================\n');

        const defaultUnusedPrefsFile = `./results/${instanceType}/ALL_REALMS/`
            + `${instanceType}_unused_preferences.txt`;
        const defaultCsvFile = `./results/${instanceType}/${realm}/`
            + `${realm}_${instanceType}_preferences_usage.csv`;
        const defaultXmlMetadataFile = getMetadataBackupPathForRealm(realm);
        const defaultOutputFile = `./backup/${instanceType}/${realm}_SitePreferences_generated_`
            + `${new Date().toISOString().split('T')[0]}.json`;

        console.log('🔧 Configuration:');
        console.log(`  Unused Prefs: ${defaultUnusedPrefsFile}`);
        console.log(`  Usage CSV: ${defaultCsvFile}`);
        console.log(`  XML Metadata: ${defaultXmlMetadataFile}`);
        console.log(`  Output: ${defaultOutputFile}\n`);

        const result = await generate({
            unusedPreferencesFile: defaultUnusedPrefsFile,
            csvFile: defaultCsvFile,
            xmlMetadataFile: defaultXmlMetadataFile,
            outputFile: defaultOutputFile,
            realm,
            instanceType,
            objectType: 'SitePreferences',
            verbose: true
        });

        if (result.success) {
            console.log('\n✅ Backup JSON generated successfully!\n');
            console.log('📊 Statistics:');
            console.log(`  Total attributes: ${result.stats.total}`);
            console.log(`  From CSV data: ${result.stats.fromCsv}`);
            console.log(`  Minimal (no CSV): ${result.stats.minimal}`);
            console.log(`  Groups: ${result.stats.groups}`);
            console.log(`  With site values: ${result.stats.withValues}\n`);
            console.log(`📁 Output: ${result.outputPath}`);
        } else {
            console.log(`\n❌ Generation failed: ${result.error}`);
        }
    }

    console.log(`\n✓ Total runtime: ${timer.stop()}`);
}
