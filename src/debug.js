import inquirer from 'inquirer';
import { startTimer } from './helpers/timer.js';
import {
    getSitePreferences,
    updateAttributeDefinitionById,
    patchSitePreferencesGroup,
    getAttributeDefinitionById,
    assignAttributeToGroup,
    getAttributeGroups,
    getAttributeGroupById,
    triggerJobExecution,
    getJobExecutionStatus,
    downloadWebdavFile
} from './api.js';
import { exportAttributesToCSV } from './helpers/csv.js';
import { generateBackupFromDefinitions, loadBackupFile, updateBackupFileAttributeGroups } from './helpers/preferenceBackup.js';
import {
    realmPrompt,
    objectTypePrompt,
    scopePrompts,
    includeDefaultsPrompt,
    resolveRealmScopeSelection,
    instanceTypePrompt
} from './prompts.js';
import {
    logCheckPreferencesStart,
    logNoMatrixFiles,
    logMatrixFilesFound,
    logSummaryHeader,
    logRealmSummary,
    logSummaryFooter
} from './helpers/log.js';
import path from 'path';
import fs from 'fs';
import { findAllMatrixFiles, getInstanceType, getBackupConfig, getWebdavConfig } from './helpers.js';
import { processPreferenceMatrixFiles, executePreferenceSummarization } from './helpers/preferenceHelper.js';
import { getActivePreferencesFromMatrices, findAllActivePreferencesUsage, findPreferenceUsage } from './helpers/preferenceUsage.js';
import { getSiblingRepositories } from './helpers/util.js';
import { repositoryPrompt, preferenceIdPrompt } from './prompts.js';
import { findAttributeInMetaFiles } from './helpers/siteXmlHelper.js';

// ============================================================================
// DEBUG COMMANDS
// Deprecated commands kept for backward compatibility and debugging
// ============================================================================

/**
 * Validate realm selection and return list to process
 * @param {Array<string>} realmsToProcess - List of realms from selection
 * @returns {boolean} True if realms are valid, false otherwise
 * @private
 */
function validateRealmsSelection(realmsToProcess) {
    if (!realmsToProcess || realmsToProcess.length === 0) {
        console.log('No realms found for the selected scope.');
        return false;
    }
    return true;
}

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
        .command('get-preferences')
        .description('(Deprecated: use analyze-preferences) Export preference definitions to CSV')
        .action(async () => {
            console.log('Note: This command is simplified. Use "analyze-preferences" for full workflow.');
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const realmName = realmAnswers.realm;
            const answers = await inquirer.prompt([
                ...objectTypePrompt(),
                ...includeDefaultsPrompt()
            ]);
            const allAttributes = await getSitePreferences(
                answers.objectType,
                realmName,
                answers.includeDefaults
            );
            
            console.log('\n================================================================================');
            console.log('FULL RESPONSE OF FIRST ATTRIBUTE:');
            console.log('================================================================================\n');
            if (allAttributes && allAttributes.length > 0) {
                console.log(JSON.stringify(allAttributes[0], null, 2));
                console.log('\n================================================================================\n');
            } else {
                console.log('No attributes found.');
                console.log('\n================================================================================\n');
            }
            
            await exportAttributesToCSV(allAttributes, realmName);
        });

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
            const groupAnswers = await inquirer.prompt([{
                name: 'groupId',
                message: 'Attribute Group ID?',
                validate: (input) => input && input.trim().length > 0 ? true : 'Group ID is required'
            }]);

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
        .command('summarize-preferences')
        .description('(Deprecated: use analyze-preferences) Summarize preferences (includes fetching)')
        .action(async () => {
            console.log('Note: This command is simplified. Use "analyze-preferences" for full workflow.');
            const timer = startTimer();
            const selection = await resolveRealmScopeSelection(inquirer.prompt);
            const realmsToProcess = selection.realmList;

            if (!validateRealmsSelection(realmsToProcess)) {
                return;
            }

            const answers = await inquirer.prompt([
                ...objectTypePrompt('SitePreferences'),
                ...scopePrompts(),
                ...includeDefaultsPrompt()
            ]);

            const { objectType, scope, siteId, includeDefaults } = answers;

            for (const realm of realmsToProcess) {
                console.log(`\nProcessing realm: ${realm}`);
                await executePreferenceSummarization({
                    realm,
                    objectType,
                    instanceType: getInstanceType(realm),
                    scope,
                    siteId,
                    includeDefaults
                });
            }

            console.log(`\n✓ Total runtime: ${timer.stop()}`);
        });

    program
        .command('check-preferences')
        .description('(Deprecated: use analyze-preferences) Check preference usage from matrix files')
        .action(async () => {
            console.log('Note: This command is simplified. Use "analyze-preferences" for full workflow.');
            logCheckPreferencesStart();

            const matrixFiles = findAllMatrixFiles();

            if (matrixFiles.length === 0) {
                logNoMatrixFiles();
                return;
            }

            logMatrixFilesFound(matrixFiles.length);

            const summary = await processPreferenceMatrixFiles(matrixFiles);

            logSummaryHeader();
            for (const stats of summary) {
                logRealmSummary(stats);
            }
            logSummaryFooter();
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
        .command('find-all-preference-usage')
        .description('(Deprecated: use analyze-preferences STEP 5) Find usage for all active preferences across all realms')
        .action(async () => {
            console.log('Note: This command is now STEP 5 of "analyze-preferences" for full workflow.');
            const timer = startTimer();
            const siblings = await getSiblingRepositories();

            if (siblings.length === 0) {
                console.log('No sibling repositories found.');
                return;
            }

            const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
            const targetPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

            const results = await findAllActivePreferencesUsage(targetPath);

            console.log('\nPREFERENCE USAGE SUMMARY\n');

            for (const result of results) {
                console.log(`${result.preferenceId}:`);
                if (result.cartridges.length === 0) {
                    console.log('  (not used in any cartridge)');
                } else {
                    result.cartridges.forEach((cartridge) => {
                        console.log(`  • ${cartridge}`);
                    });
                }
            }

            console.log(`\n✓ Total runtime: ${timer.stop()}`);
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
                        } catch (e) {
                            return 'Invalid JSON format';
                        }
                    }
                }
            ]);

            const payload = JSON.parse(payloadAnswers.payloadJson);
            console.log(`\nPatching attribute "${attributeAnswers.attributeId}" in "${objectTypeAnswers.objectType}" on realm "${realmAnswers.realm}"...`);
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
                        } catch (e) {
                            return 'Invalid JSON format';
                        }
                    }
                }
            ]);

            const payload = JSON.parse(payloadAnswers.payloadJson);
            console.log(`\nReplacing attribute "${attributeAnswers.attributeId}" in "${objectTypeAnswers.objectType}" on realm "${realmAnswers.realm}"...`);
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
                    message: `⚠️  Are you sure you want to DELETE attribute "${attributeAnswers.attributeId}"? This cannot be undone.`,
                    default: false
                }
            ]);

            if (!confirmAnswers.confirm) {
                console.log('Delete cancelled.');
                return;
            }

            console.log(`\nDeleting attribute "${attributeAnswers.attributeId}" from "${objectTypeAnswers.objectType}" on realm "${realmAnswers.realm}"...`);
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

            console.log(`\nSetting preference "${prefAnswers.attributeId}" = "${prefAnswers.value}" for site "${siteAnswers.siteId}" in group "${groupAnswers.groupId}"...`);
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
            const usageFilePath = findLatestUsageCsv(realm, instanceType);
            if (usageFilePath) {
                console.log(`Using usage CSV: ${usageFilePath}`);
            } else {
                console.log('No usage CSV found. Site values will not be included.');
            }
            const backupFilePath = await generateBackupFromDefinitions(
                objectType,
                [originalAttribute],
                realm,
                instanceType,
                usageFilePath
            );

            console.log(`✅ Backup created: ${backupFilePath}`);

            let activeBackupPath = backupFilePath;
            let metadataPath = path.join(
                process.cwd(),
                'backup_downloads',
                'meta_data_backup.xml'
            );

            const refreshAnswers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'refreshMetadata',
                    message: 'Trigger backup job and download latest metadata file? (BM/WebDAV)',
                    default: false
                }
            ]);

            if (refreshAnswers.refreshMetadata) {
                const backupConfig = getBackupConfig();
                const webdavConfig = getWebdavConfig(realm);

                if (!backupConfig.jobId) {
                    console.log('Missing backup.jobId in config.json.');
                } else if (!webdavConfig.username || !webdavConfig.password) {
                    console.log('Missing WebDAV credentials in config.json.');
                } else {
                    console.log(`Triggering job: ${backupConfig.jobId}`);
                    const executionResponse = await triggerJobExecution(
                        backupConfig.jobId,
                        realm,
                        backupConfig.ocapiVersion
                    );

                    if (executionResponse) {
                        const executionId = executionResponse.id ||
                            executionResponse.execution_id ||
                            executionResponse.job_execution_id ||
                            null;

                        if (!executionId) {
                            console.log('Could not determine job execution ID from response.');
                        } else {
                            console.log(`Job execution started. Execution ID: ${executionId}`);
                            console.log('Polling job status...');

                            const pollStart = Date.now();
                            while (true) {
                                const statusResponse = await getJobExecutionStatus(
                                    backupConfig.jobId,
                                    executionId,
                                    realm,
                                    backupConfig.ocapiVersion
                                );

                                if (!statusResponse) {
                                    console.log('Failed to fetch job status.');
                                    break;
                                }

                                const status = statusResponse.status ||
                                    statusResponse.execution_status ||
                                    statusResponse.exit_status ||
                                    'UNKNOWN';

                                const elapsedMs = Date.now() - pollStart;
                                console.log(`Job status: ${status} (elapsed ${Math.round(elapsedMs / 1000)}s)`);

                                if (status === 'OK' || status === 'FINISHED' || status === 'COMPLETED') {
                                    break;
                                }

                                if (status === 'ERROR' || status === 'FAILED' || status === 'ABORTED') {
                                    console.log(`Job failed with status: ${status}`);
                                    break;
                                }

                                if (elapsedMs >= backupConfig.timeoutMs) {
                                    console.log('Job polling timed out.');
                                    break;
                                }

                                await new Promise(resolve => setTimeout(resolve, backupConfig.pollIntervalMs));
                            }

                            console.log('Downloading backup XML from WebDAV...');
                            const outputPath = await downloadWebdavFile(
                                webdavConfig,
                                backupConfig.outputDir
                            );

                            if (outputPath) {
                                metadataPath = outputPath;
                                console.log(`Downloaded metadata: ${outputPath}`);
                            } else {
                                console.log('Failed to download metadata XML.');
                            }
                        }
                    } else {
                        console.log('Failed to trigger backup job.');
                    }
                }
            }

            if (fs.existsSync(metadataPath)) {
                console.log('\n📎 STEP 2b: Update Backup with Metadata Groups\n');
                const updateResult = await updateBackupFileAttributeGroups(
                    backupFilePath,
                    metadataPath,
                    objectType
                );

                if (updateResult) {
                    activeBackupPath = updateResult.filePath;
                    console.log(`✅ Backup updated: ${updateResult.filePath}`);
                    console.log(`   Groups added: ${updateResult.groupCount}`);
                    console.log(`   Attributes mapped: ${updateResult.attributeCount}`);
                } else {
                    console.log('⚠️  Failed to update backup with metadata groups.');
                }
            } else {
                console.log('\n⚠️  Metadata file not found. Skipping group update.');
                console.log(`   Expected: ${metadataPath}`);
            }

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
                console.log(`❌ Failed to delete attribute. Aborting test.`);
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            console.log(`✅ Attribute deleted successfully`);
            console.log('Delete response: true');

            console.log('\n🔄 STEP 4: Verify Deletion\n');
            const verifyDeleted = await getAttributeDefinitionById(objectType, attributeId, realm);
            if (verifyDeleted) {
                console.log(`⚠️  Warning: Attribute still exists after deletion attempt`);
            } else {
                console.log(`✅ Confirmed: Attribute no longer exists`);
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
                console.log(`❌ Attribute not found in backup file. Cannot restore.`);
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
                console.log(`❌ Failed to restore attribute from backup.`);
                console.log(`✓ Total runtime: ${timer.stop()}`);
                return;
            }

            console.log(`✅ Attribute restored successfully`);
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
                console.log(`✅ Attribute exists after restoration`);
                console.log('Full restored attribute:');
                console.log(JSON.stringify(verifyRestored, null, 2));
                console.log(`   Display Name: ${verifyRestored.display_name || '(none)'}`);
                console.log(`   Value Type: ${verifyRestored.value_type}`);
                console.log(`   Mandatory: ${verifyRestored.mandatory}`);
            } else {
                console.log(`❌ Attribute not found after restoration attempt`);
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
        .command('update-backup-from-metadata')
        .description('(Debug) Update backup attribute groups from meta_data_backup.xml')
        .action(async () => {
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const realm = realmAnswers.realm;
            const objectTypeAnswers = await inquirer.prompt(objectTypePrompt('SitePreferences'));
            const objectType = objectTypeAnswers.objectType;
            const instanceType = getInstanceType(realm);
            const defaultDate = new Date().toISOString().split('T')[0];
            const defaultBackupPath = path.join(
                process.cwd(),
                'backup',
                instanceType,
                `${realm}_${objectType}_backup_${defaultDate}.json`
            );
            const defaultMetadataPath = path.join(
                process.cwd(),
                'backup_downloads',
                'meta_data_backup.xml'
            );

            const answers = await inquirer.prompt([
                {
                    name: 'backupFilePath',
                    message: 'Backup file path?',
                    default: defaultBackupPath,
                    validate: (input) => fs.existsSync(input) ? true : 'Backup file not found'
                },
                {
                    name: 'metadataFilePath',
                    message: 'Metadata XML path?',
                    default: defaultMetadataPath,
                    validate: (input) => fs.existsSync(input) ? true : 'Metadata file not found'
                }
            ]);

            const result = await updateBackupFileAttributeGroups(
                answers.backupFilePath,
                answers.metadataFilePath,
                objectType
            );

            if (!result) {
                console.log('Failed to update backup file.');
                return;
            }

            console.log(`Updated backup file: ${result.filePath}`);
            console.log(`Groups added: ${result.groupCount}`);
            console.log(`Attributes mapped: ${result.attributeCount}`);
        });

    program
        .command('test-backup-job')
        .description('(Debug) Trigger SitePreferences backup job and download WebDAV ZIP')
        .action(async () => {
            const timer = startTimer();
            const realmAnswers = await inquirer.prompt(realmPrompt());
            const realm = realmAnswers.realm;

            const backupConfig = getBackupConfig();
            const webdavConfig = getWebdavConfig(realm);

            if (!backupConfig.jobId) {
                console.log('Missing backup.jobId in config.json.');
                return;
            }

            if (!webdavConfig.username || !webdavConfig.password) {
                console.log('Missing WebDAV credentials in config.json.');
                return;
            }

            console.log(`Triggering job: ${backupConfig.jobId}`);
            const executionResponse = await triggerJobExecution(
                backupConfig.jobId,
                realm,
                backupConfig.ocapiVersion
            );

            if (!executionResponse) {
                console.log('Failed to trigger backup job.');
                return;
            }

            const executionId = executionResponse.id ||
                executionResponse.execution_id ||
                executionResponse.job_execution_id ||
                null;

            if (!executionId) {
                console.log('Could not determine job execution ID from response.');
                return;
            }

            console.log(`Job execution started. Execution ID: ${executionId}`);
            console.log('Polling job status...');

            const pollStart = Date.now();
            while (true) {
                const statusResponse = await getJobExecutionStatus(
                    backupConfig.jobId,
                    executionId,
                    realm,
                    backupConfig.ocapiVersion
                );

                if (!statusResponse) {
                    console.log('Failed to fetch job status.');
                    return;
                }

                const status = statusResponse.status ||
                    statusResponse.execution_status ||
                    statusResponse.exit_status ||
                    'UNKNOWN';

                const elapsedMs = Date.now() - pollStart;
                console.log(`Job status: ${status} (elapsed ${Math.round(elapsedMs / 1000)}s)`);

                if (status === 'OK' || status === 'FINISHED' || status === 'COMPLETED') {
                    break;
                }

                if (status === 'ERROR' || status === 'FAILED' || status === 'ABORTED') {
                    console.log(`Job failed with status: ${status}`);
                    return;
                }

                if (elapsedMs >= backupConfig.timeoutMs) {
                    console.log('Job polling timed out.');
                    return;
                }

                await new Promise(resolve => setTimeout(resolve, backupConfig.pollIntervalMs));
            }

            console.log('Downloading backup ZIP from WebDAV...');
            const outputPath = await downloadWebdavFile(webdavConfig, backupConfig.outputDir);

            if (!outputPath) {
                console.log('Failed to download backup ZIP.');
                return;
            }

            console.log(`Backup downloaded to: ${outputPath}`);
            console.log(`✓ Total runtime: ${timer.stop()}`);
        });
}
