import fs from 'fs';
import path from 'path';
import { ensureResultsDir } from '../../../helpers/util.js';
import { getValidationConfig } from '../../../helpers.js';
import { logError } from '../../../helpers/log.js';

/**
 * Check if cartridge should be included based on validation config
 * @param {string} cartridge - Cartridge name
 * @param {boolean} ignoreBmCartridges - Whether to filter out BM cartridges
 * @returns {boolean} True if cartridge should be included
 * @private
 */
function shouldIncludeCartridge(cartridge, ignoreBmCartridges) {
    return !(ignoreBmCartridges && cartridge.startsWith('bm_'));
}

/**
 * Extract unique cartridge names from all sites
 * Optionally filters out bm_ cartridges based on validation config
 * @param {Array<Object>} sites - Array of site objects containing cartridges array
 * @returns {Set<string>} Set of unique cartridge names used across all sites
 */
function extractSiteCartridges(sites) {
    const validationConfig = getValidationConfig();
    const ignoreBmCartridges = validationConfig.ignoreBmCartridges;
    const siteCartridges = new Set();

    for (const site of sites) {
        if (Array.isArray(site.cartridges)) {
            for (const cartridge of site.cartridges) {
                if (shouldIncludeCartridge(cartridge, ignoreBmCartridges)) {
                    siteCartridges.add(cartridge);
                }
            }
        }
    }

    return siteCartridges;
}

/**
 * Get sites that use a specific cartridge
 * @param {string} cartridge - Cartridge name
 * @param {Array<Object>} sites - Array of site objects
 * @param {boolean} ignoreBmCartridges - Whether to filter BM cartridges
 * @returns {Array<Object>} Sites using the cartridge
 * @private
 */
function getSitesUsingCartridge(cartridge, sites, ignoreBmCartridges) {
    return sites.filter(site =>
        Array.isArray(site.cartridges) &&
        site.cartridges.includes(cartridge) &&
        shouldIncludeCartridge(cartridge, ignoreBmCartridges)
    );
}

/**
 * Compare discovered cartridges with site cartridges
 * @param {Array<string>} discoveredCartridges - Cartridges found in repo structure
 * @param {Array<Object>} sites - Array of site objects with cartridges arrays
 * @returns {Object} Comparison result with discovered cartridges and usage info
 */
export function compareCartridges(discoveredCartridges, sites) {
    const validationConfig = getValidationConfig();
    const ignoreBmCartridges = validationConfig.ignoreBmCartridges;
    const siteCartridges = extractSiteCartridges(sites);
    const comparisonResult = {
        total: discoveredCartridges.length,
        used: [],
        unused: [],
        detail: []
    };

    for (const cartridge of discoveredCartridges) {
        const isUsed = siteCartridges.has(cartridge);
        const sitesUsing = getSitesUsingCartridge(cartridge, sites, ignoreBmCartridges);
        const usageCount = sitesUsing.length;

        const detail = {
            name: cartridge,
            used: isUsed,
            usageCount,
            sites: sitesUsing.map(site => site.name)
        };

        comparisonResult.detail.push(detail);

        if (isUsed) {
            comparisonResult.used.push(cartridge);
        } else {
            comparisonResult.unused.push(cartridge);
        }
    }

    return comparisonResult;
}

/**
 * Format comparison results for console display
 * @param {Object} comparisonResult - Result from compareCartridges()
 * @returns {string} Formatted display string
 */
export function formatComparisonResults(comparisonResult) {
    const lines = [];

    lines.push('\n=== Cartridge Comparison Results ===');
    lines.push(`Total Discovered: ${comparisonResult.total}`);
    lines.push(`Used on Sites: ${comparisonResult.used.length}`);
    lines.push(`Deprecated (Unused): ${comparisonResult.unused.length}`);

    if (comparisonResult.unused.length > 0) {
        lines.push('\n--- Potentially Deprecated Cartridges ---');
        for (const cartridge of comparisonResult.unused) {
            lines.push(`  [X] ${cartridge}`);
        }
    }

    if (comparisonResult.used.length > 0) {
        lines.push('\n--- Active Cartridges ---');
        for (const cartridge of comparisonResult.used) {
            const detail = comparisonResult.detail.find(d => d.name === cartridge);
            lines.push(`  [+] ${cartridge} (used on ${detail.usageCount} site(s))`);
            if (detail.sites.length > 0) {
                lines.push(`      Sites: ${detail.sites.join(', ')}`);
            }
        }
    }

    return lines.join('\n') + '\n';
}
/**
 * Export comparison results to a text file
 * @param {Object} comparisonResult - Result from compareCartridges()
 * @param {string} realm - The realm/sandbox name
 * @param {string} [instanceTypeOverride] - Optional instance type override for output path
 * @returns {Promise<string>} Path to the written file
 */
export async function exportComparisonToFile(comparisonResult, realm, instanceTypeOverride = null) {
    const resultsDir = ensureResultsDir(realm, instanceTypeOverride);
    const filename = `${realm}_cartridge_comparison.txt`;
    const filePath = path.join(resultsDir, filename);
    const content = formatComparisonResults(comparisonResult);

    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    } catch (error) {
        logError(`Error exporting comparison results: ${error.message}`);
        throw error;
    }
}
