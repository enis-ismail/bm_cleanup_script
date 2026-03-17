import inquirer from 'inquirer';
import {
    updateAttributeDefinitionById,
    patchSitePreferencesGroup
} from '../../../api/api.js';
import {
    realmPrompt,
    objectTypePrompt,
    instanceTypePrompt
} from '../../prompts/index.js';

// ============================================================================
// TEST PATCH ATTRIBUTE
// Test patching an attribute definition with partial update
// ============================================================================

/**
 * Test patching an attribute definition with partial update.
 */
export async function testPatchAttribute() {
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
}

// ============================================================================
// TEST PUT ATTRIBUTE
// Test replacing an attribute definition with full update
// ============================================================================

/**
 * Test replacing an attribute definition with full update.
 */
export async function testPutAttribute() {
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
}

// ============================================================================
// TEST DELETE ATTRIBUTE
// Test deleting an attribute definition
// ============================================================================

/**
 * Test deleting an attribute definition.
 */
export async function testDeleteAttribute() {
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
}

// ============================================================================
// TEST SET SITE PREFERENCE
// Test setting a site preference value for a specific site
// ============================================================================

/**
 * Test setting a site preference value for a specific site.
 */
export async function testSetSitePreference() {
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
}
