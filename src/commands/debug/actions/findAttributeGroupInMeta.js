import inquirer from 'inquirer';
import path from 'path';
import { getSiblingRepositories } from '../../../io/util.js';
import { findAttributeInMetaFiles } from '../../../io/siteXmlHelper.js';
import { repositoryPrompt, preferenceIdPrompt } from '../../prompts/index.js';

// ============================================================================
// FIND ATTRIBUTE GROUP IN META
// Search for attribute group in sibling repository meta.xml files
// ============================================================================

/**
 * Search for attribute group in sibling repository meta.xml files.
 */
export async function findAttributeGroupInMeta() {
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
}
