import path from 'path';
import { getSandboxConfig, getAvailableRealms } from '../helpers.js';
import { findCartridgeFolders, transformSiteToCartridgeInfo } from './util.js';
import { exportSitesCartridgesToCSV } from './csv.js';
import { getAllSites, getSiteById } from '../api.js';
import { compareCartridges, exportComparisonToFile } from './cartridgeComparison.js';

// ============================================================================
// LIST SITES COMMAND
// ============================================================================

/**
 * List all sites and export cartridge paths to CSV
 * @param {string} realm - Realm name to fetch sites from
 * @returns {Promise<void>}
 */
export async function executeListSites(realm) {
    const sandbox = getSandboxConfig(realm);
    await exportSitesCartridgesToCSV(sandbox, realm);
}

// ============================================================================
// VALIDATE CARTRIDGES COMMAND
// ============================================================================

/**
 * Validate cartridge path settings for a single realm
 * @param {string} repositoryPath - Path to the repository containing cartridges
 * @param {string} realm - Realm name to validate against
 * @returns {Promise<string>} Path to the generated comparison report
 */
export async function executeValidateCartridges(repositoryPath, realm) {
    const selectedRepo = path.basename(repositoryPath);
    const cartridges = findCartridgeFolders(repositoryPath);
    const sandbox = getSandboxConfig(realm);

    console.log('\n[WIP] Validating cartridge paths...\n');
    console.log(`✓ Selected: ${selectedRepo}\n`);
    console.log(`Validating cartridges in: ${selectedRepo}\n`);

    // Find cartridge folders in the selected repository
    console.log('Searching for cartridge folders (full depth)...\n');

    if (cartridges.length === 0) {
        console.log('No cartridges found in the selected repository.');
        return null;
    }

    console.log(`Found ${cartridges.length} unique cartridge(s):\n`);
    for (const cartridge of cartridges) {
        console.log(`  → ${cartridge}`);
    }
    console.log();

    console.log('Fetching sites...');
    const sites = await getAllSites(sandbox);

    if (sites.length === 0) {
        console.log('No sites found.');
        return null;
    }

    console.log(`Fetching detailed cartridge paths for ${sites.length} site(s)...`);

    // Fetch detailed info for each site to get cartridges
    const siteDetails = await Promise.all(
        sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, sandbox))
    );

    const validSites = siteDetails.filter(Boolean).map((site) =>
        transformSiteToCartridgeInfo(site)
    );

    console.log(`\nCartridge Paths for ${validSites.length} site(s):\n`);

    for (const site of validSites) {
        console.log(`${site.name}:`);
        for (const cartridge of site.cartridges) {
            console.log(`  - ${cartridge}`);
        }
        console.log();
    }

    // Compare discovered cartridges with site cartridges
    const comparisonResult = compareCartridges(cartridges, validSites);

    // Export results to file
    const filePath = await exportComparisonToFile(comparisonResult, realm);
    console.log(`\n✓ Cartridge comparison saved to: ${filePath}\n`);

    return filePath;
}

// ============================================================================
// VALIDATE CARTRIDGES ALL COMMAND
// ============================================================================

/**
 * Validate cartridges across ALL configured realms in parallel
 * @param {string} repositoryPath - Path to the repository containing cartridges
 * @returns {Promise<void>}
 */
export async function executeValidateCartridgesAll(repositoryPath) {
    const selectedRepo = path.basename(repositoryPath);
    const cartridges = findCartridgeFolders(repositoryPath);
    const availableRealms = getAvailableRealms();

    console.log('\n[WIP] Validating cartridge paths across all realms...\n');
    console.log(`✓ Selected: ${selectedRepo}\n`);
    console.log(`Validating cartridges in: ${selectedRepo}\n`);

    // Find cartridge folders in the selected repository
    console.log('Searching for cartridge folders (full depth)...\n');

    if (cartridges.length === 0) {
        console.log('No cartridges found in the selected repository.');
        return;
    }

    console.log(`Found ${cartridges.length} unique cartridge(s)\n`);

    if (availableRealms.length === 0) {
        console.log('No realms configured.');
        return;
    }

    console.log(`Fetching sites from ${availableRealms.length} realm(s) in parallel...\n`);

    // Fetch sites from all realms in parallel
    const realmPromises = availableRealms.map(async (realmName) => {
        try {
            console.log(`[${realmName}] Fetching sites...`);
            const sandbox = getSandboxConfig(realmName);
            const sites = await getAllSites(sandbox);

            if (sites.length === 0) {
                console.log(`[${realmName}] ⚠ No sites found.`);
                return { realm: realmName, sites: [], success: false };
            }

            console.log(`[${realmName}] Fetching detailed data for ${sites.length} site(s)...`);

            const siteDetails = await Promise.all(
                sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, sandbox))
            );

            const validSites = siteDetails.filter(Boolean).map((site) =>
                transformSiteToCartridgeInfo(site, realmName)
            );

            console.log(`[${realmName}] ✓ Processed ${validSites.length} site(s)`);

            return {
                realm: realmName,
                sites: validSites,
                success: true
            };
        } catch (error) {
            console.log(`[${realmName}] ✗ Error: ${error.message}`);
            return {
                realm: realmName,
                sites: [],
                success: false,
                error: error.message
            };
        }
    });

    const realmResults = await Promise.all(realmPromises);

    // Aggregate all sites across all realms
    const allSitesAcrossRealms = [];
    const realmSummary = [];

    for (const result of realmResults) {
        if (result.success && result.sites.length > 0) {
            allSitesAcrossRealms.push(...result.sites);
            realmSummary.push({
                realm: result.realm,
                siteCount: result.sites.length
            });
        }
    }

    if (allSitesAcrossRealms.length === 0) {
        console.log('\nNo sites found across any realm. Aborting.\n');
        return;
    }

    console.log(`\n✓ Aggregated ${allSitesAcrossRealms.length} site(s) across ${realmSummary.length} realm(s)\n`);

    // Perform ONE comparison across ALL realms
    console.log('Comparing discovered cartridges with cartridges used across ALL realms...\n');
    const comparisonResult = compareCartridges(cartridges, allSitesAcrossRealms);

    // Export consolidated results
    const consolidatedFilePath = await exportComparisonToFile(comparisonResult, 'ALL_REALMS');
    console.log(`✓ Consolidated comparison saved to: ${consolidatedFilePath}\n`);

    return {
        realmSummary,
        comparisonResult,
        consolidatedFilePath
    };
}
