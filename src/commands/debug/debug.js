import inquirer from 'inquirer';
import { startTimer } from '../../helpers/timer.js';
import { RealmProgressDisplay } from '../../scripts/loggingScript/progressDisplay.js';
import {
    updateAttributeDefinitionById,
    patchSitePreferencesGroup,
    getAttributeDefinitionById,
    assignAttributeToGroup,
    getAttributeGroups,
    getAttributeGroupById
} from '../../api/api.js';
import { loadBackupFile } from '../../io/backupUtils.js';
import {
    realmPrompt,
    objectTypePrompt,
    instanceTypePrompt,
    repositoryPrompt,
    preferenceIdPrompt,
    groupIdPrompt
} from '../prompts/index.js';

import path from 'path';
import fs from 'fs';
import { findAllMatrixFiles, getSiblingRepositories } from '../../io/util.js';

import { getActivePreferencesFromMatrices, findPreferenceUsage } from '../../io/codeScanner.js';
import { findAttributeInMetaFiles } from '../../io/siteXmlHelper.js';
import { refreshMetadataBackupForRealm, getMetadataBackupPathForRealm } from '../../helpers/backupJob.js';
import {
    getInstanceType,
    getRealmsByInstanceType
} from '../../config/helpers/helpers.js';

// ============================================================================
// DEBUG COMMANDS
// ============================================================================

/**
 * Find the latest usage CSV file for a realm
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @returns {string|null} Path to latest usage CSV or null
 * @private
 */
function findLatestUsageCsv(realm, instanceType) {
    const realmDir = path.join(process.cwd(), 'results', instanceType, realm);
    if (!fs.existsSync(realmDir)) {
        return null;
    }

    const candidates = fs.readdirSync(realmDir)
        .filter(name => name.endsWith('_preferences_usage.csv'))
        .map(name => path.join(realmDir, name));

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return candidates[0];
}

/**
 * Register deprecated debug commands with the CLI program
 * @param {Command} program - Commander.js program instance
 */
export function registerDebugCommands(program) {
    program
        .command('list-attribute-groups')
        .description('(Debug) List attribute groups for an object type')
        .option('-v, --verbose', 'Show full JSON for first group')
        .action(async (options) => {
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const realm = realmAnswers.realm;
            const instanceType = getInstanceType(realm);
            const objectTypeAnswers = await inquirer.prompt(objectTypePrompt('SitePreferences'));
            const objectType = objectTypeAnswers.objectType;

            const groups = await getAttributeGroups(objectType, realm);
            if (!groups || groups.length === 0) {
                console.log('No attribute groups found.');
                return;
            }

            // Write to file
            const outputDir = path.join(process.cwd(), 'results', instanceType, realm);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const filePath = path.join(outputDir, `${realm}_${objectType}_attribute_groups.json`);
            fs.writeFileSync(filePath, JSON.stringify(groups, null, 2), 'utf-8');

            console.log(`\nFound ${groups.length} group(s):`);
            console.log(`Written to: ${filePath}\n`);

            if (options.verbose && groups.length > 0) {
                console.log('First group full JSON:');
                console.log(JSON.stringify(groups[0], null, 2));
                console.log('');
            }

            groups.forEach((group) => {
                const name = group.display_name || group.name || group.id;
                const count = Array.isArray(group.attribute_definitions)
                    ? group.attribute_definitions.length
                    : 0;
                console.log(`  • ${group.id} (${name}) - ${count} attribute(s)`);
            });
        });

    program
        .command('get-attribute-group')
        .description('(Debug) Get full details of a specific attribute group')
        .action(async () => {
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const realm = realmAnswers.realm;
            const instanceType = getInstanceType(realm);
            const objectTypeAnswers = await inquirer.prompt(objectTypePrompt('SitePreferences'));
            const objectType = objectTypeAnswers.objectType;
            const groupAnswers = await inquirer.prompt(groupIdPrompt());

            const group = await getAttributeGroupById(objectType, groupAnswers.groupId, realm);
            if (!group) {
                console.log(`Group "${groupAnswers.groupId}" not found.`);
                return;
            }

            // Write to file
            const outputDir = path.join(process.cwd(), 'results', instanceType, realm);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const filePath = path.join(
                outputDir,
                `${realm}_${objectType}_group_${groupAnswers.groupId}.json`
            );
            fs.writeFileSync(filePath, JSON.stringify(group, null, 2), 'utf-8');

            const name = group.display_name || group.name || group.id;
            const count = Array.isArray(group.attribute_definitions)
                ? group.attribute_definitions.length
                : 0;

            console.log(`\nGroup: ${group.id} (${name})`);
            console.log(`Attributes: ${count}`);
            console.log(`Written to: ${filePath}\n`);

            if (count > 0) {
                console.log('Attribute definitions:');
                group.attribute_definitions.forEach((attr) => {
                    const id = attr.id || attr.definition_id;
                    const displayName = attr.display_name ? ` (${attr.display_name})` : '';
                    console.log(`  • ${id}${displayName}`);
                });
            }

            console.log('\nFull JSON response:');
            console.log(JSON.stringify(group, null, 2));
        });

    program
        .command('test-active-preferences')
        .description('(Debug) Display all active preferences from matrix files')
        .action(async () => {
            const matrixFiles = findAllMatrixFiles();

            if (matrixFiles.length === 0) {
                console.log('No matrix files found.');
                return;
            }

            console.log(`Found ${matrixFiles.length} matrix file(s)\n`);

            const matrixFilePaths = matrixFiles.map(f => f.matrixFile);
            const activePreferences = Array.from(getActivePreferencesFromMatrices(matrixFilePaths)).sort();
            const count = activePreferences.length;

            console.log(`Active Preferences (${count}):\n`);
            activePreferences.forEach((pref) => {
                console.log(`  • ${pref}`);
            });
        });

    program
        .command('find-preference-usage')
        .description('(Debug) Find cartridges using a specific preference ID')
        .action(async () => {
            const timer = startTimer();
            const siblings = await getSiblingRepositories();

            if (siblings.length === 0) {
                console.log('No sibling repositories found.');
                return;
            }

            const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
            const targetPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

            const preferenceAnswers = await inquirer.prompt(preferenceIdPrompt());
            const result = await findPreferenceUsage(
                preferenceAnswers.preferenceId,
                targetPath
            );

            const { preferenceId, repositoryPath, deprecatedCartridgesCount, totalMatches, cartridges } = result;

            console.log(`\nPreference ID: ${preferenceId}`);
            console.log(`Repository: ${repositoryPath}`);
            console.log(`Deprecated cartridges filtered: ${deprecatedCartridgesCount}`);
            console.log(`Matches found: ${totalMatches}`);
            console.log(`\nCartridges using this preference (${cartridges.length}):`);

            if (cartridges.length === 0) {
                console.log('No cartridges found.');
            } else {
                cartridges.forEach((cartridge) => {
                    console.log(`  • ${cartridge}`);
                });
            }

            console.log(`\n✓ Total runtime: ${timer.stop()}`);
        });

    program
        .command('test-patch-attribute')
        .description('(Debug) Test patching an attribute definition with partial update')
        .action(async () => {
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const objectTypeAnswers = await inquirer.prompt(objectTypePrompt());
            const attributeAnswers = await inquirer.prompt([
                {
                    name: 'attributeId',
                    message: 'Attribute ID to patch?',
                    validate: (input) => input && input.trim().length > 0 ? true : 'Attribute ID is required'
                }
            ]);
            const payloadAnswers = await inquirer.prompt([
                {
                    name: 'payloadJson',
                    message: 'JSON payload for patch (e.g., {"displayName": "New Name"})?',
                    validate: (input) => {
                        try {
                            JSON.parse(input);
                            return true;
                        } catch {
                            return 'Invalid JSON format';
                        }
                    }
                }
            ]);

            const payload = JSON.parse(payloadAnswers.payloadJson);
            const patchMessage = `\nPatching attribute "${attributeAnswers.attributeId}" in `
                + `"${objectTypeAnswers.objectType}" on realm "${realmAnswers.realm}"...`;
            console.log(patchMessage);
            const result = await updateAttributeDefinitionById(
                objectTypeAnswers.objectType,
                attributeAnswers.attributeId,
                'patch',
                payload,
                realmAnswers.realm
            );

            if (result) {
                console.log('\n✅ Patch successful!');
                console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            } else {
                console.log('\n❌ Patch failed. Check logs above for details.');
            }
        });

    program
        .command('test-put-attribute')
        .description('(Debug) Test replacing an attribute definition with full update')
        .action(async () => {
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const objectTypeAnswers = await inquirer.prompt(objectTypePrompt());
            const attributeAnswers = await inquirer.prompt([
                {
                    name: 'attributeId',
                    message: 'Attribute ID to replace?',
                    validate: (input) => input && input.trim().length > 0 ? true : 'Attribute ID is required'
                }
            ]);
            const payloadAnswers = await inquirer.prompt([
                {
                    name: 'payloadJson',
                    message: 'JSON payload for full replacement (e.g., {"id": "...", "displayName": "..."})?',
                    validate: (input) => {
                        try {
                            JSON.parse(input);
                            return true;
                        } catch {
                            return 'Invalid JSON format';
                        }
                    }
                }
            ]);

            const payload = JSON.parse(payloadAnswers.payloadJson);
            const replaceMessage = `\nReplacing attribute "${attributeAnswers.attributeId}" in `
                + `"${objectTypeAnswers.objectType}" on realm "${realmAnswers.realm}"...`;
            console.log(replaceMessage);
            const result = await updateAttributeDefinitionById(
                objectTypeAnswers.objectType,
                attributeAnswers.attributeId,
                'put',
                payload,
                realmAnswers.realm
            );

            if (result) {
                console.log('\n✅ Put successful!');
                console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            } else {
                console.log('\n❌ Put failed. Check logs above for details.');
            }
        });

    program
        .command('test-delete-attribute')
        .description('(Debug) Test deleting an attribute definition')
        .action(async () => {
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const objectTypeAnswers = await inquirer.prompt(objectTypePrompt());
            const attributeAnswers = await inquirer.prompt([
                {
                    name: 'attributeId',
                    message: 'Attribute ID to delete?',
                    validate: (input) => input && input.trim().length > 0 ? true : 'Attribute ID is required'
                }
            ]);
            const confirmAnswers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `⚠️  Are you sure you want to DELETE attribute "${attributeAnswers.attributeId}"? `
                        + 'This cannot be undone.',
                    default: false
                }
            ]);

            if (!confirmAnswers.confirm) {
                console.log('Delete cancelled.');
                return;
            }

            const deleteMessage = `\nDeleting attribute "${attributeAnswers.attributeId}" from `
                + `"${objectTypeAnswers.objectType}" on realm "${realmAnswers.realm}"...`;
            console.log(deleteMessage);
            const success = await updateAttributeDefinitionById(
                objectTypeAnswers.objectType,
                attributeAnswers.attributeId,
                'delete',
                null,
                realmAnswers.realm
            );

            if (success) {
                console.log('\n✅ Delete successful!');
            } else {
                console.log('\n❌ Delete failed. Check logs above for details.');
            }
        });

    program
        .command('test-set-site-preference')
        .description('(Debug) Test setting a site preference value for a specific site')
        .action(async () => {
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const siteAnswers = await inquirer.prompt([
                {
                    name: 'siteId',
                    message: 'Site ID (e.g., EU)?',
                    validate: (input) => input && input.trim().length > 0 ? true : 'Site ID is required'
                }
            ]);
            const groupAnswers = await inquirer.prompt([
                {
                    name: 'groupId',
                    message: 'Attribute Group ID (e.g., ThisTestAttributeGroup)?',
                    validate: (input) => input && input.trim().length > 0 ? true : 'Group ID is required'
                }
            ]);
            const instanceAnswers = await inquirer.prompt(instanceTypePrompt('development'));
            const prefAnswers = await inquirer.prompt([
                {
                    name: 'attributeId',
                    message: 'Attribute ID (e.g., ThisTestAttribute)?',
                    validate: (input) => input && input.trim().length > 0 ? true : 'Attribute ID is required'
                },
                {
                    name: 'value',
                    message: 'Value to set?',
                    validate: (input) => input !== undefined ? true : 'Value is required'
                }
            ]);

            // Ensure attribute ID has 'c_' prefix for custom attributes
            const attributeKey = prefAnswers.attributeId.startsWith('c_')
                ? prefAnswers.attributeId
                : `c_${prefAnswers.attributeId}`;

            const payload = {
                [attributeKey]: prefAnswers.value
            };

            const setMessage = `\nSetting preference "${prefAnswers.attributeId}" = "${prefAnswers.value}" `
                + `for site "${siteAnswers.siteId}" in group "${groupAnswers.groupId}"...`;
            console.log(setMessage);
            const result = await patchSitePreferencesGroup(
                siteAnswers.siteId,
                groupAnswers.groupId,
                instanceAnswers.instanceType,
                payload,
                realmAnswers.realm
            );

            if (result) {
                console.log('\n✅ Site preference set successfully!');
                console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            } else {
                console.log('\n❌ Failed to set site preference. Check logs above for details.');
            }
        });

    program
        .command('test-backup-restore-cycle')
        .description('(Debug) Test full backup → delete → restore cycle for an attribute')
        .action(async () => {
            const timer = startTimer();
            console.log('\n========================================');
            console.log('BACKUP & RESTORE TEST SCENARIO');
            console.log('========================================\n');

            // Step 1: Get realm and attribute info
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const realm = realmAnswers.realm;
            const instanceType = getInstanceType(realm);

            const objectTypeAnswers = await inquirer.prompt(objectTypePrompt('SitePreferences'));
            const objectType = objectTypeAnswers.objectType;

            const attributeAnswers = await inquirer.prompt([
                {
                    name: 'attributeId',
                    message: 'Attribute ID to test (e.g., ThisTestAttribute)?',
                    default: 'ThisTestAttribute',
                    validate: (input) => input && input.trim().length > 0 ? true : 'Attribute ID is required'
                }
            ]);
            const attributeId = attributeAnswers.attributeId;

            console.log('\n📋 STEP 1: Fetch Current Attribute Definition\n');
            const originalAttribute = await getAttributeDefinitionById(objectType, attributeId, realm);

            if (!originalAttribute) {
                console.log(`❌ Attribute "${attributeId}" not found. Aborting test.`);
                return;
            }

            console.log(`✅ Retrieved attribute: ${attributeId}`);
            console.log('Full response:');
            console.log(JSON.stringify(originalAttribute, null, 2));
            console.log(`   Display Name: ${originalAttribute.display_name || '(none)'}`);
            console.log(`   Value Type: ${originalAttribute.value_type}`);
            console.log(`   Mandatory: ${originalAttribute.mandatory}`);

            console.log('\n💾 STEP 2: Create Backup File\n');

            let metadataPath = getMetadataBackupPathForRealm(realm);
            const refreshAnswers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'refreshMetadata',
                    message: 'Trigger backup job and download latest metadata file? (BM/WebDAV)',
                    default: false
                }
            ]);

            if (refreshAnswers.refreshMetadata) {
                console.log('Triggering backup job and downloading metadata...');
                const refreshResult = await refreshMetadataBackupForRealm(realm, instanceType);

                if (refreshResult.ok) {
                    metadataPath = refreshResult.filePath;
                    console.log(`Downloaded metadata: ${refreshResult.filePath}`);
                } else {
                    console.log(`Failed to refresh metadata: ${refreshResult.reason}`);
                }
            }

            if (!fs.existsSync(metadataPath)) {
                console.log('\n⚠️  Metadata file not found. Groups may be missing.');
                console.log(`   Expected: ${metadataPath}`);
            }

            const usageFilePath = findLatestUsageCsv(realm, instanceType);
            if (usageFilePath) {
                console.log(`Using usage CSV: ${usageFilePath}`);
            } else {
                console.log('No usage CSV found. Site values will not be included.');
            }

            const backupDir = path.join(process.cwd(), 'backup', instanceType);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            const backupDate = new Date().toISOString().split('T')[0];
            const backupFilePath = path.join(
                backupDir,
                `${realm}_${objectType}_backup_${backupDate}.json`
            );

            const unusedDir = path.join(process.cwd(), 'results', instanceType, realm);
            if (!fs.existsSync(unusedDir)) {
                fs.mkdirSync(unusedDir, { recursive: true });
            }
            const unusedPreferencesFile = path.join(
                unusedDir,
                `${realm}_debug_unused_preferences.txt`
            );
            const unusedLines = [
                `Unused Preferences for Realm: ${realm}`,
                `Generated: ${new Date().toISOString()}`,
                'Total Unused: 1',
                '',
                '--- Preference IDs ---',
                attributeId
            ];
            fs.writeFileSync(unusedPreferencesFile, unusedLines.join('\n'), 'utf-8');

            const { generate } = await import('./helpers/generateSitePreferencesJSON.js');
            const backupResult = await generate({
                unusedPreferencesFile,
                csvFile: usageFilePath,
                xmlMetadataFile: metadataPath,
                outputFile: backupFilePath,
                realm,
                instanceType,
                objectType,
                verbose: true
            });

            if (!backupResult.success) {
                console.log(`❌ Failed to create backup: ${backupResult.error}`);
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            console.log(`✅ Backup created: ${backupResult.outputPath}`);
            let activeBackupPath = backupResult.outputPath;

            console.log('\n⚠️  STEP 3: Delete Attribute\n');
            const deleteConfirm = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Delete attribute "${attributeId}" from ${realm}?`,
                    default: false
                }
            ]);

            if (!deleteConfirm.confirm) {
                console.log('❌ Delete cancelled. Test aborted.');
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            const deleteSuccess = await updateAttributeDefinitionById(
                objectType,
                attributeId,
                'delete',
                null,
                realm
            );

            if (!deleteSuccess) {
                console.log('❌ Failed to delete attribute. Aborting test.');
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            console.log('✅ Attribute deleted successfully');
            console.log('Delete response: true');

            console.log('\n🔄 STEP 4: Verify Deletion\n');
            const verifyDeleted = await getAttributeDefinitionById(objectType, attributeId, realm);
            if (verifyDeleted) {
                console.log('⚠️  Warning: Attribute still exists after deletion attempt');
            } else {
                console.log('✅ Confirmed: Attribute no longer exists');
            }

            console.log('\n♻️  STEP 5: Restore from Backup\n');
            const restoreConfirm = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Restore attribute "${attributeId}" from backup?`,
                    default: true
                }
            ]);

            if (!restoreConfirm.confirm) {
                console.log('❌ Restore cancelled. Attribute remains deleted.');
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            const backup = await loadBackupFile(activeBackupPath);
            const attributeToRestore = backup.attributes.find(attr => attr.id === attributeId);

            if (!attributeToRestore) {
                console.log('❌ Attribute not found in backup file. Cannot restore.');
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            console.log('Restoring attribute with PUT...');
            const restored = await updateAttributeDefinitionById(
                objectType,
                attributeId,
                'put',
                attributeToRestore,
                realm
            );

            if (!restored) {
                console.log('❌ Failed to restore attribute from backup.');
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            console.log('✅ Attribute restored successfully');
            console.log('PUT response:');
            console.log(JSON.stringify(restored, null, 2));

            // Restore group membership
            console.log('\n📎 Restoring group membership...');
            const groupsToRestore = backup.attribute_groups.filter(group =>
                group.attributes.includes(attributeId)
            );

            if (groupsToRestore.length === 0) {
                console.log('⚠️  No group assignments found in backup');
            } else {
                for (const group of groupsToRestore) {
                    console.log(`   Assigning to group: ${group.group_id}`);
                    const assigned = await assignAttributeToGroup(
                        objectType,
                        group.group_id,
                        attributeId,
                        realm
                    );
                    if (assigned) {
                        console.log(`   ✅ Assigned to ${group.group_id}`);
                        console.log('   Assignment response:');
                        console.log(JSON.stringify(assigned, null, 2));
                    } else {
                        console.log(`   ❌ Failed to assign to ${group.group_id}`);
                    }
                }
            }

            // Restore site values
            console.log('\n💾 Restoring site values...');
            const siteValueData = backup.site_values?.[attributeId];

            if (!siteValueData || !siteValueData.siteValues || Object.keys(siteValueData.siteValues).length === 0) {
                console.log('⚠️  No site values found in backup');
            } else {
                const { groupId, siteValues } = siteValueData;
                console.log(`   Group: ${groupId}`);
                console.log(`   Sites with values: ${Object.keys(siteValues).length}`);

                // Ensure attribute ID has c_ prefix for the payload
                const attributeKey = attributeId.startsWith('c_') ? attributeId : `c_${attributeId}`;

                for (const [siteId, value] of Object.entries(siteValues)) {
                    console.log(`   Setting ${siteId}: "${value}"`);
                    const payload = {
                        [attributeKey]: value
                    };
                    const result = await patchSitePreferencesGroup(
                        siteId,
                        groupId,
                        instanceType,
                        payload,
                        realm
                    );
                    if (result) {
                        console.log(`   ✅ Set value for ${siteId}`);
                        console.log('   PATCH response:');
                        console.log(JSON.stringify(result, null, 2));
                    } else {
                        console.log(`   ❌ Failed to set value for ${siteId}`);
                    }
                }
            }

            console.log('\n✅ STEP 6: Verify Restoration\n');
            const verifyRestored = await getAttributeDefinitionById(objectType, attributeId, realm);
            if (verifyRestored) {
                console.log('✅ Attribute exists after restoration');
                console.log('Full restored attribute:');
                console.log(JSON.stringify(verifyRestored, null, 2));
                console.log(`   Display Name: ${verifyRestored.display_name || '(none)'}`);
                console.log(`   Value Type: ${verifyRestored.value_type}`);
                console.log(`   Mandatory: ${verifyRestored.mandatory}`);
            } else {
                console.log('❌ Attribute not found after restoration attempt');
            }

            console.log('\n========================================');
            console.log('TEST COMPLETE');
            console.log('========================================\n');
            console.log(`✓ Total runtime: ${timer.stop()}`);
        });

    program
        .command('find-attribute-group-in-meta')
        .description('(Debug) Search for attribute group in sibling repository meta.xml files')
        .action(async () => {
            const siblings = await getSiblingRepositories();

            if (siblings.length === 0) {
                console.log('No sibling repositories found.');
                return;
            }

            const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
            const targetPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

            const attributeAnswers = await inquirer.prompt(preferenceIdPrompt());
            const attributeId = attributeAnswers.preferenceId;

            console.log(`\nSearching for attribute "${attributeId}" in meta.xml files...`);
            const results = await findAttributeInMetaFiles(targetPath, attributeId);

            if (results.length === 0) {
                console.log(`\n❌ Attribute "${attributeId}" not found in any meta.xml file`);
                return;
            }

            console.log(`\n✅ Found in ${results.length} file(s):\n`);
            for (const result of results) {
                console.log(`📁 Site Folder: ${result.siteFolder}`);
                console.log(`   File: ${result.relativePath}`);
                console.log(`   Absolute: ${result.filePath}`);
                console.log(`   Group ID: ${result.groupId}`);
                console.log('');
            }
        });

    program
        .command('test-generate-backup-json')
        .description('[TEST] Generate SitePreferences backup JSON from unused preferences list and usage CSV')
        .action(async () => {
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
            const { generate } = await import('./helpers/generateSitePreferencesJSON.js');

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
        });

    program
        .command('test-concurrent-timers')
        .description('(Debug) Test dynamic parent/child progress logging')
        .action(async () => {
            const UPDATE_INTERVAL_MS = 250;
            const overallTimer = startTimer();

            console.log(`\n${'='.repeat(80)}`);
            console.log('🚀 Starting dynamic parent/child progress test');
            console.log(`${'='.repeat(80)}\n`);
            const progressDisplay = new RealmProgressDisplay(UPDATE_INTERVAL_MS);

            const realms = [
                {
                    name: 'bcwr-080',
                    hostname: 'bcwr-080.dx.commercecloud.salesforce.com'
                },
                {
                    name: 'eu05',
                    hostname: 'eu05.dx.commercecloud.salesforce.com'
                }
            ];

            const childDefinitions = realms.flatMap((realm, realmIndex) => ([
                {
                    realmIndex,
                    label: 'Fetching Data',
                    durationMs: 2000 + Math.floor(Math.random() * 3000),
                    startDelayMs: Math.floor(Math.random() * 1200)
                },
                {
                    realmIndex,
                    label: 'Building Matrices',
                    durationMs: 3000 + Math.floor(Math.random() * 4000),
                    startDelayMs: 1200 + Math.floor(Math.random() * 2000)
                },
                {
                    realmIndex,
                    label: 'Exporting Results',
                    durationMs: 1500 + Math.floor(Math.random() * 2500),
                    startDelayMs: 3200 + Math.floor(Math.random() * 2000)
                }
            ]));

            const runChildProcess = (realm, label, durationMs, startDelayMs, stepKey) => {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        progressDisplay.startStep(realm.hostname, realm.name, stepKey, label);
                        const startTime = Date.now();
                        const interval = setInterval(() => {
                            const elapsed = Date.now() - startTime;
                            const percent = Math.min(100, Math.round((elapsed / durationMs) * 100));
                            progressDisplay.setStepProgress(realm.hostname, stepKey, percent);
                        }, 100);

                        setTimeout(() => {
                            clearInterval(interval);
                            progressDisplay.completeStep(realm.hostname, stepKey);
                            resolve({ realm: realm.name, label, durationMs });
                        }, durationMs);
                    }, startDelayMs);
                });
            };

            try {
                progressDisplay.start();

                const tasks = childDefinitions.map((definition, index) => {
                    const realm = realms[definition.realmIndex];
                    const stepKey = `${definition.label}-${index}`;
                    return runChildProcess(
                        realm,
                        definition.label,
                        definition.durationMs,
                        definition.startDelayMs,
                        stepKey
                    );
                });

                const results = await Promise.all(tasks);
                progressDisplay.stop();

                console.log(`\n${'='.repeat(80)}`);
                console.log('📊 Parent/Child Progress Results');
                console.log(`${'='.repeat(80)}\n`);

                results.forEach((result) => {
                    const seconds = (result.durationMs / 1000).toFixed(2);
                    console.log(`  ${result.realm} - ${result.label}: ${seconds}s`);
                });

                const totalElapsed = overallTimer.stop();
                console.log(`\n  Total elapsed: ${totalElapsed}`);
                console.log('  ✓ Dynamic progress test completed successfully!\n');
            } catch (error) {
                progressDisplay.stop();
                console.error(`\n❌ Error: ${error.message}`);
            }
        });

    // ========================================================================
    // debug-progress — Simulates analyze-preferences display lifecycle
    // ========================================================================

    program
        .command('debug-progress')
        .description('(Debug) Simulate analyze-preferences progress display with console interference')
        .action(async () => {
            const overallTimer = startTimer();

            console.log(`\n${'='.repeat(80)}`);
            console.log('🚀 Starting progress display simulation');
            console.log('   Simulates 4 realms in parallel, sequential steps per realm');
            console.log('   Injects console.error / console.warn calls to test suppression');
            console.log(`${'='.repeat(80)}\n`);

            const display = new RealmProgressDisplay(250);

            const realms = [
                { name: 'APAC', hostname: 'apac.dx.commercecloud.salesforce.com' },
                { name: 'EU05', hostname: 'eu05.dx.commercecloud.salesforce.com' },
                { name: 'GB', hostname: 'gb.dx.commercecloud.salesforce.com' },
                { name: 'PNA', hostname: 'pna.dx.commercecloud.salesforce.com' }
            ];

            // Step definitions: each realm goes through these in order
            // Mirrors the real analyze-preferences flow: backup -> fetch -> groups -> matrices -> export
            const stepDefs = [
                { key: 'backup', label: 'Downloading Backup', durationMs: [1500, 3000] },
                { key: 'fetch', label: 'Reading Metadata XML', durationMs: [1000, 2000] },
                { key: 'groups', label: 'Reading Attribute Groups', durationMs: [1000, 2000] },
                { key: 'matrices', label: 'Building Matrices', durationMs: [2000, 3500] },
                { key: 'export', label: 'Exporting Results', durationMs: [500, 1500] }
            ];

            function randomBetween(min, max) {
                return min + Math.floor(Math.random() * (max - min));
            }

            function sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            /**
             * Run a single step: start → animate progress → complete
             */
            async function runStep(realm, stepDef) {
                const duration = randomBetween(stepDef.durationMs[0], stepDef.durationMs[1]);
                display.startStep(realm.hostname, realm.name, stepDef.key, stepDef.label);

                const startTime = Date.now();
                while (Date.now() - startTime < duration) {
                    const elapsed = Date.now() - startTime;
                    const percent = Math.min(100, Math.round((elapsed / duration) * 100));
                    display.setStepProgress(realm.hostname, stepDef.key, percent);
                    await sleep(100);
                }

                display.completeStep(realm.hostname, stepDef.key);
            }

            /**
             * Process one realm: run all steps sequentially, then mark complete.
             * Injects console.error / console.warn calls mid-flight to test suppression.
             */
            async function processRealm(realm, realmIndex) {
                // Stagger start times so realms don't begin simultaneously
                await sleep(realmIndex * randomBetween(200, 600));

                display.setTotalSteps(realm.hostname, stepDefs.length);

                for (let i = 0; i < stepDefs.length; i++) {
                    await runStep(realm, stepDefs[i]);

                    // Inject console interference after certain steps
                    if (i === 0) {
                        console.log(`[LEAK] ${realm.name}: this console.log should be suppressed`);
                    }
                    if (i === 1) {
                        console.error(`[LEAK] ${realm.name}: this console.error should be suppressed`);
                    }
                    if (i === 2) {
                        console.warn(`[LEAK] ${realm.name}: this console.warn should be suppressed`);
                    }
                }

                display.completeRealm(realm.hostname);
            }

            try {
                display.start();

                // Run all realms in parallel
                await Promise.all(realms.map((realm, i) => processRealm(realm, i)));

                display.finish();

                console.log(`\n${'='.repeat(80)}`);
                console.log('📊 Progress Display Test Results');
                console.log(`${'='.repeat(80)}\n`);
                console.log('  If you see any [LEAK] messages above the separator,');
                console.log('  console suppression failed.\n');

                const totalElapsed = overallTimer.stop();
                console.log(`  Total elapsed: ${totalElapsed}`);
                console.log('  ✓ Progress display test completed successfully!\n');
            } catch (error) {
                display.stop();
                console.error(`\n❌ Error: ${error.message}`);
            }
        });

}
