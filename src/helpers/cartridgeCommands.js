import path from 'path';
import { getAvailableRealms, getRealmConfig, getInstanceType } from '../helpers.js';
import { findCartridgeFolders, transformSiteToCartridgeInfo, calculateValidationStats } from './util.js';
import { exportSitesCartridgesToCSV } from './csv.js';
import { getAllSites, getSiteById } from '../api.js';
import { compareCartridges, exportComparisonToFile } from './cartridgeComparison.js';
import {
    findSiteXmlFiles,
    parseSiteXml,
    compareSiteXmlWithLive,
    exportSiteXmlComparison
} from './siteXmlHelper.js';

// ============================================================================
// LIST SITES COMMAND
// ============================================================================

/**
 * List all sites and export cartridge paths to CSV
 * @param {string} realm - Realm name to fetch sites from
 * @returns {Promise<void>}
 */
export async function executeListSites(realm) {
    await exportSitesCartridgesToCSV(realm);
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
    const sites = await getAllSites(realm);

    if (sites.length === 0) {
        console.log('No sites found.');
        return null;
    }

    console.log(`Fetching detailed cartridge paths for ${sites.length} site(s)...`);

    const siteDetails = await Promise.all(
        sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, realm))
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
 * @param {string} [instanceTypeOverride] - Optional instance type override for output path
 * @returns {Promise<void>}
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

    console.log('\n[WIP] Validating cartridge paths across all realms...\n');
    console.log(`✓ Selected: ${selectedRepo}\n`);
    console.log(`Validating cartridges in: ${selectedRepo}\n`);

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
            const sites = await getAllSites(realmName);

            if (sites.length === 0) {
                console.log(`[${realmName}] ⚠ No sites found.`);
                return { realm: realmName, sites: [], success: false };
            }

            console.log(`[${realmName}] Fetching detailed data for ${sites.length} site(s)...`);

            const siteDetails = await Promise.all(
                sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, realmName))
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
    const instanceTypeScope = instanceTypeOverride || (() => {
        if (!realmsToProcess || realmsToProcess.length === 0) {
            return null;
        }

        const instanceTypes = new Set(realmsToProcess.map((realmName) => getInstanceType(realmName)));
        return instanceTypes.size === 1 ? Array.from(instanceTypes)[0] : null;
    })();

    const consolidatedFilePath = await exportComparisonToFile(
        comparisonResult,
        'ALL_REALMS',
        instanceTypeScope
    );
    console.log(`✓ Consolidated comparison saved to: ${consolidatedFilePath}\n`);

    return {
        realmSummary,
        comparisonResult,
        consolidatedFilePath
    };
}

// ============================================================================
// VALIDATE SITE XML COMMAND
// ============================================================================

/**
 * Validate that site.xml files match live SFCC cartridge paths
 * @param {string} repositoryPath - Path to the repository containing site.xml files
 * @param {string} realm - Realm name to validate against
 * @returns {Promise<Object>} Validation results including stats and report path
 */
export async function executeValidateSiteXml(repositoryPath, realm) {
    const selectedRepo = path.basename(repositoryPath);
    const realmConfig = getRealmConfig(realm);

    console.log('\n[WIP] Validating site.xml files against live SFCC...\n');
    console.log(`✓ Selected: ${selectedRepo}\n`);

    // Check if realm has siteTemplatesPath configured
    if (!realmConfig.siteTemplatesPath) {
        console.log(
            `\n✗ Error: Realm "${realm}" does not have ` +
            '"siteTemplatesPath" configured in config.json\n'
        );
        console.log('Please add "siteTemplatesPath" to the realm configuration.');
        console.log('Example: "siteTemplatesPath": "sites/site_template_bcwr080"\n');
        return null;
    }

    console.log(`Site Templates Path: ${realmConfig.siteTemplatesPath}\n`);

    const siteXmlFiles = await findSiteXmlFiles(repositoryPath, realmConfig.siteTemplatesPath);

    if (siteXmlFiles.length === 0) {
        console.log('No site.xml files found.\n');
        return null;
    }

    console.log(`Found ${siteXmlFiles.length} site.xml file(s):\n`);
    siteXmlFiles.forEach(f => {
        console.log(`  → ${f.siteLocale}: ${f.relativePath}`);
    });
    console.log();

    // Fetch live sites from SFCC
    console.log('Fetching live site data from SFCC...');
    const sites = await getAllSites(realm);

    if (sites.length === 0) {
        console.log('No sites found on SFCC.\n');
        return null;
    }

    console.log(`Fetching detailed cartridge paths for ${sites.length} site(s)...\n`);

    const siteDetails = await Promise.all(
        sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, realm))
    );

    const liveSitesMap = {};
    siteDetails.filter(Boolean).forEach((site) => {
        const siteInfo = transformSiteToCartridgeInfo(site);
        liveSitesMap[siteInfo.id] = siteInfo.cartridges;
    });

    // Parse and compare each site.xml
    console.log('Parsing and comparing site.xml files...\n');
    const comparisons = [];

    for (const xmlFile of siteXmlFiles) {
        try {
            const xmlData = await parseSiteXml(xmlFile.filePath);
            console.log(`[${xmlData.siteId}] Parsed ${xmlFile.relativePath}`);

            if (!liveSitesMap[xmlData.siteId]) {
                console.log(`  ⚠ Warning: Site "${xmlData.siteId}" not found on live SFCC`);
                continue;
            }

            const comparison = compareSiteXmlWithLive(
                xmlData.cartridges,
                liveSitesMap[xmlData.siteId]
            );

            comparisons.push({
                siteId: xmlData.siteId,
                xmlFile: xmlFile.relativePath,
                comparison
            });

            console.log(`  ${comparison.isMatch ? '✓ Match' : '✗ Mismatch'}`);
        } catch (error) {
            console.log(`  ✗ Error parsing ${xmlFile.relativePath}: ${error.message}`);
        }
    }

    if (comparisons.length === 0) {
        console.log('\nNo comparisons to export.\n');
        return null;
    }

    // Export results
    const reportPath = await exportSiteXmlComparison(comparisons, realm);
    console.log(`\n✓ Validation report saved to: ${reportPath}\n`);

    // Return stats for summary display
    const stats = calculateValidationStats(comparisons);

    return {
        stats,
        reportPath,
        comparisons
    };
}
