import inquirer from 'inquirer';
import { getInstanceType } from '../../../config/helpers/helpers.js';
import { resolveRealmScopeSelection } from '../../prompts/commonPrompts.js';
import { LOG_PREFIX, TIER_ORDER } from '../../../config/constants.js';
import { exportTicketFilesForRealm } from '../helpers/ticketExportHelper.js';

// ============================================================================
// EXPORT TICKET LISTS ACTION
// ============================================================================

/**
 * Prompt the user to select which priority tiers to export.
 *
 * @param {Function} promptFn - Inquirer prompt function
 * @returns {Promise<string[]>} Selected tier names
 * @private
 */
async function promptTierSelection(promptFn) {
    const answers = await promptFn([
        {
            name: 'tiers',
            type: 'checkbox',
            message: 'Select priority levels to export:',
            choices: [
                { name: '[P1] Safe to Delete - No code, no values', value: 'P1', checked: true },
                { name: '[P2] Likely Safe - No code, has values', value: 'P2', checked: true },
                { name: '[P3] Deprecated Code Only - No values', value: 'P3', checked: true },
                { name: '[P4] Deprecated Code + Values', value: 'P4', checked: true }
            ],
            validate: (selected) => selected.length > 0 || 'Select at least one tier'
        }
    ]);

    return answers.tiers.sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b]);
}

/**
 * Export per-P-level Jira ticket attachment files for selected realms.
 * Reads each realm's _preferences_for_deletion.txt and splits it into
 * one clean .txt file per priority tier, saved under jira_tickets/.
 *
 * @returns {Promise<void>}
 */
export async function exportTicketLists() {
    const promptFn = inquirer.prompt.bind(inquirer);

    console.log('\nExport Jira Ticket Lists');
    console.log('Creates per-realm, per-P-level files from existing deletion candidate lists.\n');

    // 1. Realm selection
    const { realmList, instanceTypeOverride } = await resolveRealmScopeSelection(promptFn);
    if (!realmList || realmList.length === 0) {
        console.log(`${LOG_PREFIX.WARNING} No realms selected. Aborting.`);
        return;
    }

    // 2. Tier selection
    const selectedTiers = await promptTierSelection(promptFn);

    console.log(`\nExporting [${selectedTiers.join(', ')}] for ${realmList.length} realm(s)...\n`);

    // 3. Export per realm
    const allResults = [];
    for (const realm of realmList) {
        const realmInstanceType = instanceTypeOverride || getInstanceType(realm);
        const result = exportTicketFilesForRealm(realm, realmInstanceType, { tiers: selectedTiers });
        allResults.push(result);
    }

    // 4. Print summary
    let totalFiles = 0;
    for (const result of allResults) {
        if (!result.sourceExists) {
            console.log(`  ${LOG_PREFIX.WARNING} ${result.realm}: no deletion file found`
                + ' - run analyze-preferences first');
            continue;
        }

        if (result.written.length === 0) {
            console.log(`  ${LOG_PREFIX.WARNING} ${result.realm}: no preferences found for selected tiers`);
            continue;
        }

        const jiraDir = `${result.outputDir}\\jira_tickets\\`;
        console.log(`  ${LOG_PREFIX.INFO} ${result.realm}: wrote ${result.written.length} file(s) -> ${jiraDir}`);
        for (const file of result.written) {
            console.log(`      [${file.tier}] ${file.count} preferences  ->  ${file.filePath}`);
        }
        if (result.skipped.length > 0) {
            console.log(`      Skipped (empty): ${result.skipped.join(', ')}`);
        }
        totalFiles += result.written.length;
    }

    console.log(`\n${LOG_PREFIX.INFO} Done - ${totalFiles} ticket file(s) written.`);
}

