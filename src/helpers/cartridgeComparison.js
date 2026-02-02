import fs from 'fs';
import path from 'path';
import { ensureResultsDir } from './util.js';
import { getValidationConfig } from '../helpers.js';

/**
 * Compare discovered cartridges from repo structure against cartridges used on sites
 * Main list is the discovered cartridges, with usage status from sites
 */

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

    sites.forEach((site) => {
        if (Array.isArray(site.cartridges)) {
            site.cartridges.forEach((cartridge) => {
                // Optionally filter out bm_ cartridges based on config
                if (!(ignoreBmCartridges && cartridge.startsWith('bm_'))) {
                    siteCartridges.add(cartridge);
                }
            });
        }
    });

    return siteCartridges;
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

    discoveredCartridges.forEach((cartridge) => {
        const isUsed = siteCartridges.has(cartridge);
        const usageCount = sites.filter((site) =>
            Array.isArray(site.cartridges) &&
            site.cartridges.includes(cartridge) &&
            !(ignoreBmCartridges && cartridge.startsWith('bm_'))
        ).length;

        const detail = {
            name: cartridge,
            used: isUsed,
            usageCount,
            sites: sites
                .filter((site) =>
                    Array.isArray(site.cartridges) &&
                    site.cartridges.includes(cartridge) &&
                    !(ignoreBmCartridges && cartridge.startsWith('bm_'))
                )
                .map((site) => site.name)
        };

        comparisonResult.detail.push(detail);

        if (isUsed) {
            comparisonResult.used.push(cartridge);
        } else {
            comparisonResult.unused.push(cartridge);
        }
    });

    return comparisonResult;
}

/**
 * Format comparison results for console display
 * @param {Object} comparisonResult - Result from compareCartridges()
 * @returns {string} Formatted display string
 */
export function formatComparisonResults(comparisonResult) {
    let output = '\n=== Cartridge Comparison Results ===\n';
    output += `Total Discovered: ${comparisonResult.total}\n`;
    output += `Used on Sites: ${comparisonResult.used.length}\n`;
    output += `Deprecated (Unused): ${comparisonResult.unused.length}\n`;

    if (comparisonResult.unused.length > 0) {
        output += '\n--- Potentially Deprecated Cartridges ---\n';
        comparisonResult.unused.forEach((cartridge) => {
            output += `  [X] ${cartridge}\n`;
        });
    }

    if (comparisonResult.used.length > 0) {
        output += '\n--- Active Cartridges ---\n';
        comparisonResult.used.forEach((cartridge) => {
            const detail = comparisonResult.detail.find((d) => d.name === cartridge);
            output += `  [+] ${cartridge} (used on ${detail.usageCount} site(s))\n`;
            if (detail.sites.length > 0) {
                output += `      Sites: ${detail.sites.join(', ')}\n`;
            }
        });
    }

    return output;
}
/**
 * Export comparison results to a text file
 * @param {Object} comparisonResult - Result from compareCartridges()
 * @param {string} realm - The realm/sandbox name
 * @returns {Promise<string>} Path to the written file
 */
export async function exportComparisonToFile(comparisonResult, realm) {
    const resultsDir = ensureResultsDir(realm);
    const filename = `${realm}_cartridge_comparison.txt`;
    const filePath = path.join(resultsDir, filename);
    const content = formatComparisonResults(comparisonResult);

    try {
        // Create results directory if it doesn't exist
        // Write file
        fs.writeFileSync(filePath, content, 'utf-8');

        return filePath;
    } catch (error) {
        console.error('Error exporting comparison results:', error.message);
        throw error;
    }
}
