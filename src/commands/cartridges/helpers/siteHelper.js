import { getAllSites, getSiteById } from '../../../api/api.js';
import { transformSiteToCartridgeInfo } from '../../../io/util.js';
import { LOG_PREFIX } from '../../../config/constants.js';

/**
 * Fetch and transform site data for cartridge information
 * @param {string} realm - Realm name to fetch sites from
 * @returns {Promise<Array|null>} Array of transformed sites or null on error
 */
export async function fetchAndTransformSites(realm) {
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

/**
 * Fetch sites from multiple realms in parallel and aggregate results
 * @param {string[]} realms - Array of realm names to fetch from
 * @returns {Promise<{allSites: Array, realmSummary: Array}>} Aggregated sites and per-realm summaries
 */
export async function fetchSitesFromAllRealms(realms) {
    const realmResults = await Promise.all(realms.map(async (realmName) => {
        try {
            console.log(`  [${realmName}] Fetching sites...`);
            const validSites = await fetchAndTransformSites(realmName);

            if (!validSites || validSites.length === 0) {
                console.log(`  [${realmName}] ${LOG_PREFIX.WARNING} No sites found.`);
                return { realm: realmName, sites: [], success: false };
            }

            console.log(`  [${realmName}] ${LOG_PREFIX.INFO} Processed ${validSites.length} site(s)`);
            return { realm: realmName, sites: validSites, success: true };
        } catch (error) {
            console.log(`  [${realmName}] ${LOG_PREFIX.ERROR} ${error.message}`);
            return { realm: realmName, sites: [], success: false, error: error.message };
        }
    }));

    const allSites = [];
    const realmSummary = [];

    for (const result of realmResults) {
        if (result.success && result.sites.length > 0) {
            allSites.push(...result.sites);
            realmSummary.push({ realm: result.realm, siteCount: result.sites.length });
        }
    }

    return { allSites, realmSummary };
}
