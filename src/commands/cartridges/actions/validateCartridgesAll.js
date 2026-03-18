import path from 'path';
import inquirer from 'inquirer';
import { getAvailableRealms, getInstanceType } from '../../../index.js';
import { findCartridgeFolders } from '../../../io/util.js';
import { compareCartridges, exportComparisonToFile } from '../helpers/cartridgeComparison.js';
import { fetchSitesFromAllRealms } from '../helpers/siteHelper.js';
import { LOG_PREFIX, IDENTIFIERS } from '../../../config/constants.js';
import {
    logCartridgeList,
    logCartridgeValidationSummaryHeader,
    logRealmsProcessed,
    logCartridgeValidationStats,
    logCartridgeValidationWarning,
    logCartridgeValidationSummaryFooter
} from '../../../scripts/loggingScript/log.js';
import { resolveRealmScopeSelection } from '../../prompts/commonPrompts.js';
import { promptForRepositoryPath } from './shared.js';

// ============================================================================
// VALIDATE CARTRIDGES ALL
// Validate cartridges across ALL configured realms (parallel)
// ============================================================================

/**
 * Validate cartridges across ALL configured realms (command handler).
 */
export async function validateCartridgesAll() {
    const selection = await resolveRealmScopeSelection(inquirer.prompt);
    const { realmList, instanceTypeOverride } = selection;

    if (!realmList || realmList.length === 0) {
        console.log('No realms found for the selected scope.');
        return;
    }

    const targetPath = await promptForRepositoryPath();
    if (!targetPath) {
        return;
    }

    const result = await executeValidateCartridgesAll(
        targetPath,
        realmList,
        instanceTypeOverride
    );

    if (!result) {
        return;
    }

    logCartridgeValidationSummaryHeader();
    logRealmsProcessed(result.realmSummary);
    logCartridgeValidationStats(result);

    if (result.comparisonResult.unused.length > 0) {
        logCartridgeValidationWarning(
            result.comparisonResult.unused.length,
            result.consolidatedFilePath
        );
    }

    logCartridgeValidationSummaryFooter();
}

/**
 * Validate cartridges across ALL configured realms in parallel.
 * @param {string} repositoryPath - Path to the repository containing cartridges
 * @param {string[]} [realmsToProcess] - Realms to validate against
 * @param {string} [instanceTypeOverride] - Optional instance type override for output path
 * @returns {Promise<Object|undefined>} Validation results or undefined
 */
export async function executeValidateCartridgesAll(
    repositoryPath,
    realmsToProcess = null,
    instanceTypeOverride = null
) {
    const selectedRepo = path.basename(repositoryPath);
    const cartridges = findCartridgeFolders(repositoryPath);
    const availableRealms = realmsToProcess && realmsToProcess.length > 0
        ? realmsToProcess
        : getAvailableRealms();

    console.log('\n[WIP] Validating cartridge paths across all realms...');
    console.log(`\n${LOG_PREFIX.INFO} Selected: ${selectedRepo}`);
    console.log(`  Validating cartridges in: ${selectedRepo}\n`);

    if (cartridges.length === 0) {
        console.log('No cartridges found in the selected repository.');
        return;
    }

    logCartridgeList(cartridges);

    if (availableRealms.length === 0) {
        console.log('No realms configured.');
        return;
    }

    // Fetch sites from all realms in parallel
    console.log(`Fetching sites from ${availableRealms.length} realm(s) in parallel...\n`);
    const { allSites, realmSummary } = await fetchSitesFromAllRealms(availableRealms);

    if (allSites.length === 0) {
        console.log('\nNo sites found across any realm. Aborting.\n');
        return;
    }

    console.log(`\n${LOG_PREFIX.INFO} Aggregated ${allSites.length} site(s) `
        + `across ${realmSummary.length} realm(s)\n`);

    // Compare and export
    console.log('Comparing discovered cartridges with cartridges used across ALL realms...\n');
    const comparisonResult = compareCartridges(cartridges, allSites);
    const instanceTypeScope = instanceTypeOverride || deriveInstanceType(realmsToProcess);

    const consolidatedFilePath = await exportComparisonToFile(
        comparisonResult,
        IDENTIFIERS.ALL_REALMS,
        instanceTypeScope
    );
    console.log(`${LOG_PREFIX.INFO} Consolidated comparison saved to: ${consolidatedFilePath}\n`);

    return { realmSummary, comparisonResult, consolidatedFilePath };
}

// ============================================================================
// PRIVATE HELPER FUNCTIONS
// ============================================================================

/**
 * Derive a single instance type from a list of realms, if all share the same type.
 * @param {string[]} realms - Realm names
 * @returns {string|null} Instance type if uniform, null otherwise
 * @private
 */
function deriveInstanceType(realms) {
    if (!realms || realms.length === 0) {
        return null;
    }
    const types = new Set(realms.map((realm) => getInstanceType(realm)));
    return types.size === 1 ? Array.from(types)[0] : null;
}
