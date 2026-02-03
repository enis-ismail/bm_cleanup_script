import path from 'path';
import { getAvailableRealms, getRealmConfig, getInstanceType } from '../helpers.js';
import { findCartridgeFolders, transformSiteToCartridgeInfo, calculateValidationStats } from './util.js';
import { exportSitesCartridgesToCSV } from './csv.js';
import { getAllSites, getSiteById } from '../api.js';
import { compareCartridges, exportComparisonToFile } from './cartridgeComparison.js';
import { LOG_PREFIX } from './constants.js';
import { logCartridgeList } from './log.js';
import {
    findSiteXmlFiles,
    parseSiteXml,
    compareSiteXmlWithLive,
    exportSiteXmlComparison
} from './siteXmlHelper.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Fetch and transform site data for cartridge information
 * @param {string} realm - Realm name to fetch sites from
 * @returns {Promise<Array|null>} Array of transformed sites or null on error
 */
async function fetchAndTransformSites(realm) {
    const sites = await getAllSites(realm);

    if (sites.length === 0) {
        return null;
    }

    const siteDetails = await Promise.all(
        sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, realm))
    );

    return siteDetails.filter(Boolean).map((site) =>
        transformSiteToCartridgeInfo(site, realm)
    );
}

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
    console.log(`${LOG_PREFIX.INFO} Selected: ${selectedRepo}\n`);
    console.log(`Validating cartridges in: ${selectedRepo}\n`);

    if (cartridges.length === 0) {
        console.log('No cartridges found in the selected repository.');
        return;
    }

    logCartridgeList(cartridges);

    if (availableRealms.length === 0) {
        console.log('No realms configured.');
        return;
    }

    console.log(`Fetching sites from ${availableRealms.length} realm(s) in parallel...\n`);

    // Fetch sites from all realms in parallel
    const realmPromises = availableRealms.map(async (realmName) => {
        try {
            console.log(`[${realmName}] Fetching sites...`);
            const validSites = await fetchAndTransformSites(realmName);

            if (!validSites || validSites.length === 0) {
                console.log(`[${realmName}] ${LOG_PREFIX.WARNING} No sites found.`);
                return { realm: realmName, sites: [], success: false };
            }

            console.log(`[${realmName}] ${LOG_PREFIX.INFO} Processed ${validSites.length} site(s)`);

            return {
                realm: realmName,
                sites: validSites,
                success: true
            };
        } catch (error) {
            console.log(`[${realmName}] ${LOG_PREFIX.ERROR} ${error.message}`);
            return {
                realm: realmName,
                sites: [],
                success: false,
                error: error.message
            };
        }
    });

    const realmResults = await Promise.all(realmPromises);

    // Aggregate sites and summaries
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

    console.log(`\n${LOG_PREFIX.INFO} Aggregated ${allSitesAcrossRealms.length} site(s) `
        + `across ${realmSummary.length} realm(s)\n`);

    // Compare and export
    console.log('Comparing discovered cartridges with cartridges used across ALL realms...\n');
    const comparisonResult = compareCartridges(cartridges, allSitesAcrossRealms);

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
    console.log(`${LOG_PREFIX.INFO} Consolidated comparison saved to: ${consolidatedFilePath}\n`);

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
    const siteXmlFiles = realmConfig.siteTemplatesPath
        ? await findSiteXmlFiles(repositoryPath, realmConfig.siteTemplatesPath)
        : [];

    console.log('\n[WIP] Validating site.xml files against live SFCC...\n');
    console.log(`${LOG_PREFIX.INFO} Selected: ${selectedRepo}\n`);

    // Validate configuration
    if (!realmConfig.siteTemplatesPath) {
        console.log(
            `\n${LOG_PREFIX.ERROR} Realm "${realm}" does not have "siteTemplatesPath" configured in config.json\n`
        );
        console.log('Please add "siteTemplatesPath" to the realm configuration.');
        console.log('Example: "siteTemplatesPath": "sites/site_template_bcwr080"\n');
        return null;
    }

    console.log(`Site Templates Path: ${realmConfig.siteTemplatesPath}\n`);

    if (siteXmlFiles.length === 0) {
        console.log('No site.xml files found.\n');
        return null;
    }

    console.log(`Found ${siteXmlFiles.length} site.xml file(s):\n`);
    siteXmlFiles.forEach(f => {
        console.log(`  → ${f.siteLocale}: ${f.relativePath}`);
    });
    console.log();

    // Fetch live sites and build map
    console.log('Fetching live site data from SFCC...');
    const validSites = await fetchAndTransformSites(realm);

    if (!validSites || validSites.length === 0) {
        console.log('No sites found on SFCC.\n');
        return null;
    }

    const liveSitesMap = {};
    validSites.forEach((site) => {
        liveSitesMap[site.id] = site.cartridges;
    });

    // Parse and compare
    console.log('\nParsing and comparing site.xml files...\n');
    const comparisons = [];

    for (const xmlFile of siteXmlFiles) {
        try {
            const xmlData = await parseSiteXml(xmlFile.filePath);
            console.log(`[${xmlData.siteId}] Parsed ${xmlFile.relativePath}`);

            if (!liveSitesMap[xmlData.siteId]) {
                console.log(`  ${LOG_PREFIX.WARNING} Site "${xmlData.siteId}" not found on live SFCC`);
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

            console.log(`  ${comparison.isMatch ? `${LOG_PREFIX.INFO} Match` : `${LOG_PREFIX.ERROR} Mismatch`}`);
        } catch (error) {
            console.log(`  ${LOG_PREFIX.ERROR} Error parsing ${xmlFile.relativePath}: ${error.message}`);
        }
    }

    if (comparisons.length === 0) {
        console.log('\nNo comparisons to export.\n');
        return null;
    }

    // Export and return stats
    const reportPath = await exportSiteXmlComparison(comparisons, realm);
    console.log(`\n${LOG_PREFIX.INFO} Validation report saved to: ${reportPath}\n`);

    const stats = calculateValidationStats(comparisons);

    return {
        stats,
        reportPath,
        comparisons
    };
}
