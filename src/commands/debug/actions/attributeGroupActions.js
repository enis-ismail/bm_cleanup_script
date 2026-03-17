import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import {
    getAttributeGroups,
    getAttributeGroupById
} from '../../../api/api.js';
import {
    realmPrompt,
    objectTypePrompt,
    groupIdPrompt
} from '../../prompts/index.js';
import { getInstanceType } from '../../../config/helpers/helpers.js';

// ============================================================================
// LIST ATTRIBUTE GROUPS
// List attribute groups for an object type
// ============================================================================

/**
 * List attribute groups for an object type.
 * @param {Object} options - Command options
 * @param {boolean} [options.verbose] - Show full JSON for first group
 */
export async function listAttributeGroups(options) {
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
}

// ============================================================================
// GET ATTRIBUTE GROUP
// Get full details of a specific attribute group
// ============================================================================

/**
 * Get full details of a specific attribute group.
 */
export async function getAttributeGroup() {
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

    const groupIds = groups.map(g => g.id);
    const groupAnswers = await inquirer.prompt(groupIdPrompt(groupIds));

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
}
