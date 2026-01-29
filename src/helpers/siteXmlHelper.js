import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';

/**
 * Find all site.xml files in a site templates directory
 * @param {string} repoPath - Path to the repository
 * @param {string} siteTemplatesPath - Relative path to site templates (e.g., "sites/site_template_bcwr080")
 * @returns {Promise<Array<Object>>} Array of site.xml file information
 */
export async function findSiteXmlFiles(repoPath, siteTemplatesPath) {
    const siteXmlFiles = [];
    const fullSiteTemplatesPath = path.join(repoPath, siteTemplatesPath);

    if (!fs.existsSync(fullSiteTemplatesPath)) {
        console.log(`[!] Site templates path not found: ${fullSiteTemplatesPath}`);
        return siteXmlFiles;
    }

    // Navigate to sites subdirectory: sites/site_template_<realm>/sites
    const sitesDir = path.join(fullSiteTemplatesPath, 'sites');

    if (!fs.existsSync(sitesDir)) {
        console.log(`[!] Sites directory not found: ${sitesDir}`);
        return siteXmlFiles;
    }

    // Read all site locale directories
    const siteLocales = fs.readdirSync(sitesDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    for (const localeDir of siteLocales) {
        const siteXmlPath = path.join(sitesDir, localeDir.name, 'site.xml');

        if (fs.existsSync(siteXmlPath)) {
            siteXmlFiles.push({
                siteLocale: localeDir.name,
                filePath: siteXmlPath,
                relativePath: path.relative(repoPath, siteXmlPath)
            });
        }
    }

    return siteXmlFiles;
}

/**
 * Parse site.xml and extract cartridge path
 * @param {string} siteXmlPath - Full path to site.xml file
 * @returns {Promise<Object>} Parsed site data including cartridges
 */
export async function parseSiteXml(siteXmlPath) {
    return new Promise((resolve, reject) => {
        const xmlContent = fs.readFileSync(siteXmlPath, 'utf-8');

        parseString(xmlContent, (err, result) => {
            if (err) {
                reject(err);
                return;
            }

            try {
                // Navigate XML structure to find cartridges
                const site = result.site;
                const siteId = site.$?.['site-id'] || 'Unknown';
                
                // Find custom-cartridges element
                let cartridgePath = '';
                const cartridges = [];
                
                if (site['custom-cartridges'] && site['custom-cartridges'][0]) {
                    const customCartridges = site['custom-cartridges'][0];
                    
                    // Check if it's a string (colon-separated list)
                    if (typeof customCartridges === 'string') {
                        cartridgePath = customCartridges;
                        cartridges.push(...customCartridges
                            .split(':')
                            .map(c => c.trim())
                            .filter(c => c.length > 0)
                        );
                    }
                    // Check if it contains cartridge elements
                    else if (customCartridges.cartridge) {
                        const cartridgeElements = Array.isArray(customCartridges.cartridge)
                            ? customCartridges.cartridge
                            : [customCartridges.cartridge];
                        
                        cartridgeElements.forEach(cart => {
                            if (typeof cart === 'string') {
                                cartridges.push(cart.trim());
                            } else if (cart._) {
                                cartridges.push(cart._.trim());
                            }
                        });
                        
                        cartridgePath = cartridges.join(':');
                    }
                }

                resolve({
                    siteId,
                    cartridgePath,
                    cartridges,
                    raw: result
                });
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}

/**
 * Compare site.xml cartridges with live SFCC cartridges
 * @param {Array<string>} xmlCartridges - Cartridges from site.xml
 * @param {Array<string>} liveCartridges - Cartridges from SFCC API
 * @returns {Object} Comparison result
 */
export function compareSiteXmlWithLive(xmlCartridges, liveCartridges) {
    const xmlSet = new Set(xmlCartridges);
    const liveSet = new Set(liveCartridges);

    const matching = xmlCartridges.filter(c => liveSet.has(c));
    const onlyInXml = xmlCartridges.filter(c => !liveSet.has(c));
    const onlyInLive = liveCartridges.filter(c => !xmlSet.has(c));

    return {
        matching,
        onlyInXml,
        onlyInLive,
        isMatch: onlyInXml.length === 0 && onlyInLive.length === 0,
        xmlCount: xmlCartridges.length,
        liveCount: liveCartridges.length
    };
}

/**
 * Format site.xml comparison results for display
 * @param {string} siteId - Site identifier
 * @param {Object} comparison - Comparison result from compareSiteXmlWithLive
 * @param {string} xmlFilePath - Path to site.xml file
 * @returns {string} Formatted display string
 */
export function formatSiteXmlComparison(siteId, comparison, xmlFilePath) {
    let output = `\n=== Site: ${siteId} ===\n`;
    output += `XML File: ${xmlFilePath}\n`;
    output += `Status: ${comparison.isMatch ? '[OK] MATCH' : '[X] MISMATCH'}\n`;
    output += `XML Cartridges: ${comparison.xmlCount} | Live Cartridges: ${comparison.liveCount}\n`;

    if (!comparison.isMatch) {
        if (comparison.onlyInXml.length > 0) {
            output += `\n[!] In XML but NOT on live (${comparison.onlyInXml.length}):\n`;
            comparison.onlyInXml.forEach(c => {
                output += `    - ${c}\n`;
            });
        }

        if (comparison.onlyInLive.length > 0) {
            output += `\n[!] On live but NOT in XML (${comparison.onlyInLive.length}):\n`;
            comparison.onlyInLive.forEach(c => {
                output += `    - ${c}\n`;
            });
        }
    }

    return output;
}

/**
 * Export site.xml comparison results to file
 * @param {Array<Object>} comparisons - Array of comparison results
 * @param {string} realm - Realm name
 * @returns {Promise<string>} Path to written file
 */
export async function exportSiteXmlComparison(comparisons, realm) {
    const resultsDir = path.join(process.cwd(), 'results', realm);
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }

    const filename = `${realm}_site_xml_validation.txt`;
    const filePath = path.join(resultsDir, filename);

    let content = '='.repeat(80) + '\n';
    content += 'SITE.XML VALIDATION REPORT\n';
    content += '='.repeat(80) + '\n';

    for (const comp of comparisons) {
        content += formatSiteXmlComparison(comp.siteId, comp.comparison, comp.xmlFile);
    }

    content += '\n' + '='.repeat(80) + '\n';
    content += 'SUMMARY\n';
    content += '='.repeat(80) + '\n';

    const matchCount = comparisons.filter(c => c.comparison.isMatch).length;
    const mismatchCount = comparisons.length - matchCount;

    content += `Total Sites Validated: ${comparisons.length}\n`;
    content += `Matching: ${matchCount}\n`;
    content += `Mismatched: ${mismatchCount}\n`;

    fs.writeFileSync(filePath, content, 'utf-8');

    return filePath;
}
