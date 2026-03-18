import inquirer from 'inquirer';
import { exportSitesCartridgesToCSV } from '../../../io/csv.js';
import { resolveRealmScopeSelection } from '../../prompts/commonPrompts.js';

// ============================================================================
// LIST SITES
// List all sites and export cartridge paths to CSV
// ============================================================================

/**
 * List all sites and export cartridge paths to CSV (command handler).
 */
export async function listSites() {
    const selection = await resolveRealmScopeSelection(inquirer.prompt);
    const realmsToProcess = selection.realmList;

    if (!realmsToProcess || realmsToProcess.length === 0) {
        console.log('No realms found for the selected scope.');
        return;
    }

    for (const realm of realmsToProcess) {
        await executeListSites(realm);
    }
}

/**
 * List all sites and export cartridge paths to CSV.
 * @param {string} realm - Realm name to fetch sites from
 * @returns {Promise<void>}
 */
export async function executeListSites(realm) {
    await exportSitesCartridgesToCSV(realm);
}
