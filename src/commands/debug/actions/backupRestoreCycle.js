import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import { startTimer } from '../../../helpers/timer.js';
import {
    updateAttributeDefinitionById,
    patchSitePreferencesGroup,
    getAttributeDefinitionById,
    assignAttributeToGroup
} from '../../../api/api.js';
import { loadBackupFile } from '../../../io/backupUtils.js';
import {
    realmPrompt,
    objectTypePrompt
} from '../../prompts/index.js';
import { getInstanceType } from '../../../config/helpers/helpers.js';
import { refreshMetadataBackupForRealm, getMetadataBackupPathForRealm } from '../../../helpers/backupJob.js';

// ============================================================================
// TEST BACKUP RESTORE CYCLE
// Test full backup → delete → restore cycle for an attribute
// ============================================================================

/**
 * Test full backup → delete → restore cycle for an attribute.
 */
export async function testBackupRestoreCycle() {
    const timer = startTimer();
    console.log('\n========================================');
    console.log('BACKUP & RESTORE TEST SCENARIO');
    console.log('========================================\n');

    // --- STEP 1: Get realm and attribute info ---
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

    // --- STEP 2: Create backup file ---
    console.log('\n💾 STEP 2: Create Backup File\n');

    const { backupPath, usageFilePath } = await prepareBackupPaths(realm, instanceType);

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

    const { generate } = await import('../helpers/generateSitePreferencesJSON.js');
    const backupResult = await generate({
        unusedPreferencesFile,
        csvFile: usageFilePath,
        xmlMetadataFile: backupPath,
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
    const activeBackupPath = backupResult.outputPath;

    // --- STEP 3: Delete attribute ---
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

    // --- STEP 4: Verify deletion ---
    console.log('\n🔄 STEP 4: Verify Deletion\n');
    const verifyDeleted = await getAttributeDefinitionById(objectType, attributeId, realm);
    if (verifyDeleted) {
        console.log('⚠️  Warning: Attribute still exists after deletion attempt');
    } else {
        console.log('✅ Confirmed: Attribute no longer exists');
    }

    // --- STEP 5: Restore from backup ---
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
    await restoreGroupMembership(backup, objectType, attributeId, realm);

    // Restore site values
    await restoreSiteValues(backup, attributeId, instanceType, realm);

    // --- STEP 6: Verify restoration ---
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
}

// ============================================================================
// PRIVATE HELPER FUNCTIONS
// ============================================================================

/**
 * Find the latest usage CSV file for a realm.
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
 * Prepare backup and usage file paths, optionally refreshing metadata.
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @returns {Promise<{ backupPath: string, usageFilePath: string|null }>}
 * @private
 */
async function prepareBackupPaths(realm, instanceType) {
    let backupPath = getMetadataBackupPathForRealm(realm);
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
            backupPath = refreshResult.filePath;
            console.log(`Downloaded metadata: ${refreshResult.filePath}`);
        } else {
            console.log(`Failed to refresh metadata: ${refreshResult.reason}`);
        }
    }

    if (!fs.existsSync(backupPath)) {
        console.log('\n⚠️  Metadata file not found. Groups may be missing.');
        console.log(`   Expected: ${backupPath}`);
    }

    const usageFilePath = findLatestUsageCsv(realm, instanceType);
    if (usageFilePath) {
        console.log(`Using usage CSV: ${usageFilePath}`);
    } else {
        console.log('No usage CSV found. Site values will not be included.');
    }

    return { backupPath, usageFilePath };
}

/**
 * Restore group memberships from a backup file.
 * @param {Object} backup - Loaded backup object
 * @param {string} objectType - Object type (e.g. 'SitePreferences')
 * @param {string} attributeId - Attribute ID to restore groups for
 * @param {string} realm - Realm name
 * @returns {Promise<void>}
 * @private
 */
async function restoreGroupMembership(backup, objectType, attributeId, realm) {
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
}

/**
 * Restore site-level preference values from a backup file.
 * @param {Object} backup - Loaded backup object
 * @param {string} attributeId - Attribute ID to restore values for
 * @param {string} instanceType - Instance type
 * @param {string} realm - Realm name
 * @returns {Promise<void>}
 * @private
 */
async function restoreSiteValues(backup, attributeId, instanceType, realm) {
    console.log('\n💾 Restoring site values...');
    const siteValueData = backup.site_values?.[attributeId];

    if (!siteValueData || !siteValueData.siteValues
        || Object.keys(siteValueData.siteValues).length === 0) {
        console.log('⚠️  No site values found in backup');
        return;
    }

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
