import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';
import { ensureResultsDir } from './util.js';
import { SEPARATOR } from './constants.js';
import { logError } from './log.js';

/**
 * Find all site.xml files in a site templates directory
 * @param {string} repoPath - Path to the repository
 * @param {string} siteTemplatesPath - Relative path to site templates (e.g., "sites/site_template_bcwr080")
 * @returns {Promise<Array<Object>>} Array of site.xml file information
 */

/**
 * Extract cartridges from custom-cartridges XML element
 * @param {*} customCartridges - The custom-cartridges element from parsed XML
 * @returns {Object} Object with cartridges array and cartridgePath string
 * @private
 */
function extractCartridgesFromXml(customCartridges) {
    const cartridges = [];
    let cartridgePath = '';

    // Check if it's a string (colon-separated list)
    if (typeof customCartridges === 'string') {
        cartridgePath = customCartridges;
        cartridges.push(
            ...customCartridges
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

        for (const cart of cartridgeElements) {
            if (typeof cart === 'string') {
                cartridges.push(cart.trim());
            } else if (cart._) {
                cartridges.push(cart._.trim());
            }
        }
        cartridgePath = cartridges.join(':');
    }

    return { cartridges, cartridgePath };
}

/**
 * Find all site.xml files in a site templates directory
 * @param {string} repoPath - Path to the repository
 * @param {string} siteTemplatesPath - Relative path to site templates (e.g., "sites/site_template_bcwr080")
 * @returns {Promise<Array<Object>>} Array of site.xml file information
 */
export async function findSiteXmlFiles(repoPath, siteTemplatesPath) {
    const siteXmlFiles = [];
    const fullSiteTemplatesPath = path.join(repoPath, siteTemplatesPath);
    const sitesDir = path.join(fullSiteTemplatesPath, 'sites');

    if (!fs.existsSync(fullSiteTemplatesPath)) {
        console.log(`[!] Site templates path not found: ${fullSiteTemplatesPath}`);
        return siteXmlFiles;
    }

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
                const site = result.site;
                const siteId = site.$?.['site-id'] || 'Unknown';
                const customCartridges = site['custom-cartridges']?.[0];
                const { cartridges, cartridgePath } = customCartridges
                    ? extractCartridgesFromXml(customCartridges)
                    : { cartridges: [], cartridgePath: '' };

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
    const isMatch = onlyInXml.length === 0 && onlyInLive.length === 0;

    return {
        matching,
        onlyInXml,
        onlyInLive,
        isMatch,
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

/**
 * Write validation results to file with error handling
 * @param {string} filePath - Absolute path to output file
 * @param {string} content - File content to write
 * @private
 */
function writeSiteXmlValidationFile(filePath, content) {
    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`Site XML validation report written to ${filePath}`);
    } catch (error) {
        logError(`Failed to write site XML validation report ${filePath}: ${error.message}`);
        throw error;
    }
}
export function formatSiteXmlComparison(siteId, comparison, xmlFilePath) {
    const lines = [];
    const status = comparison.isMatch ? '[OK] MATCH' : '[X] MISMATCH';

    lines.push(`\n=== Site: ${siteId} ===`);
    lines.push(`XML File: ${xmlFilePath}`);
    lines.push(`Status: ${status}`);
    lines.push(`XML Cartridges: ${comparison.xmlCount} | Live Cartridges: ${comparison.liveCount}`);

    if (!comparison.isMatch) {
        if (comparison.onlyInXml.length > 0) {
            lines.push(`\n[!] In XML but NOT on live (${comparison.onlyInXml.length}):`);
            for (const c of comparison.onlyInXml) {
                lines.push(`    - ${c}`);
            }
        }

        if (comparison.onlyInLive.length > 0) {
            lines.push(`\n[!] On live but NOT in XML (${comparison.onlyInLive.length}):`);
            for (const c of comparison.onlyInLive) {
                lines.push(`    - ${c}`);
            }
        }
    }

    return lines.join('\n') + '\n';
}

/**
 * Export site.xml comparison results to file
 * @param {Array<Object>} comparisons - Array of comparison results
 * @param {string} realm - Realm name
 * @returns {Promise<string>} Path to written file
 */
export async function exportSiteXmlComparison(comparisons, realm) {
    const resultsDir = ensureResultsDir(realm);
    const filePath = path.join(resultsDir, `${realm}_site_xml_validation.txt`);
    const matchCount = comparisons.filter(c => c.comparison.isMatch).length;
    const mismatchCount = comparisons.length - matchCount;

    const lines = [
        SEPARATOR,
        'SITE.XML VALIDATION REPORT',
        SEPARATOR
    ];

    for (const comp of comparisons) {
        lines.push(formatSiteXmlComparison(comp.siteId, comp.comparison, comp.xmlFile));
    }

    lines.push(SEPARATOR);
    lines.push('SUMMARY');
    lines.push(SEPARATOR);
    lines.push(`Total Sites Validated: ${comparisons.length}`);
    lines.push(`Matching: ${matchCount}`);
    lines.push(`Mismatched: ${mismatchCount}`);

    const content = lines.join('\n');

    writeSiteXmlValidationFile(filePath, content);

    return filePath;
}

/**
 * Parse XML content into JavaScript object
 * @param {string} xmlContent - Raw XML content
 * @returns {Promise<Object>} Parsed XML object
 * @private
 */
async function parseXmlContent(xmlContent) {
    return new Promise((resolve, reject) => {
        parseString(xmlContent, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

/**
 * Extract attribute groups from parsed meta.xml structure
 * @param {Object} parsedXml - Parsed XML object
 * @returns {Array<Object>} Array of attribute groups with their attributes
 * @private
 */
function extractAttributeGroupsFromMeta(parsedXml) {
    const groups = [];
    
    try {
        // Navigate XML structure: metadata > type-extension > group-definitions > attribute-group
        const metadata = parsedXml.metadata;
        if (!metadata || !metadata['type-extension']) {
            return groups;
        }
        
        const typeExtension = Array.isArray(metadata['type-extension'])
            ? metadata['type-extension'][0]
            : metadata['type-extension'];
        
        groups.push(...extractAttributeGroupsFromTypeExtension(typeExtension));
    } catch (error) {
        logError(`Failed to extract attribute groups from XML: ${error.message}`);
    }
    
    return groups;
}

/**
 * Extract attribute groups from a single type-extension node
 * @param {Object} typeExtension - Parsed XML type-extension node
 * @returns {Array<Object>} Array of attribute groups
 * @private
 */
function extractAttributeGroupsFromTypeExtension(typeExtension) {
    const groups = [];

    if (!typeExtension || !typeExtension['group-definitions']) {
        return groups;
    }

    const groupDefinitions = typeExtension['group-definitions'][0];
    if (!groupDefinitions || !groupDefinitions['attribute-group']) {
        return groups;
    }

    const attributeGroups = Array.isArray(groupDefinitions['attribute-group'])
        ? groupDefinitions['attribute-group']
        : [groupDefinitions['attribute-group']];

    for (const group of attributeGroups) {
        const groupId = group.$?.['group-id'];
        const groupDisplayName = group['display-name']?.[0]?.['_'] || groupId;

        const attributes = Array.isArray(group.attribute)
            ? group.attribute
            : (group.attribute ? [group.attribute] : []);

        const attributeIds = attributes
            .map(attr => attr.$?.['attribute-id'])
            .filter(id => id)
            .map(id => id.replace(/^c_/, '')); // Normalize by removing c_ prefix

        if (groupId && attributeIds.length > 0) {
            groups.push({
                group_id: groupId,
                group_display_name: groupDisplayName,
                attributes: attributeIds
            });
        }
    }

    return groups;
}

/**
 * Read attribute group definitions for a specific type from a metadata backup XML
 * @param {string} metadataFilePath - Path to meta_data_backup.xml
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @returns {Promise<Array<Object>>} Array of attribute groups
 */
export async function getAttributeGroupsFromMetadataFile(metadataFilePath, objectType) {
    if (!fs.existsSync(metadataFilePath)) {
        logError(`Metadata file not found: ${metadataFilePath}`);
        return [];
    }

    try {
        const xmlContent = fs.readFileSync(metadataFilePath, 'utf-8');
        const parsed = await parseXmlContent(xmlContent);
        const metadata = parsed.metadata;

        if (!metadata || !metadata['type-extension']) {
            logError('Metadata XML missing type-extension nodes');
            return [];
        }

        const typeExtensions = Array.isArray(metadata['type-extension'])
            ? metadata['type-extension']
            : [metadata['type-extension']];

        const matching = typeExtensions.filter(ext => ext.$?.['type-id'] === objectType);
        if (matching.length === 0) {
            logError(`No type-extension found for type-id '${objectType}' in metadata file`);
            return [];
        }

        const groups = [];
        for (const ext of matching) {
            groups.push(...extractAttributeGroupsFromTypeExtension(ext));
        }

        return groups;
    } catch (error) {
        logError(`Failed to parse metadata file: ${error.message}`);
        return [];
    }
}

/**
 * Get all meta.xml files from a repository's sites directory
 * @param {string} repoPath - Path to the repository
 * @returns {Array<{path: string, siteFolder: string}>} Array of meta file paths
 * @private
 */
function findMetaXmlFiles(repoPath) {
    const metaFiles = [];
    const sitesDir = path.join(repoPath, 'sites');
    
    if (!fs.existsSync(sitesDir)) {
        logError(`Sites directory not found: ${sitesDir}`);
        return metaFiles;
    }
    
    try {
        const siteSubdirs = fs.readdirSync(sitesDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
        
        for (const subdir of siteSubdirs) {
            const metaDir = path.join(sitesDir, subdir.name, 'meta');
            
            if (!fs.existsSync(metaDir)) {
                continue;
            }
            
            const xmlFiles = fs.readdirSync(metaDir)
                .filter(file => file.endsWith('.xml'))
                .map(file => ({
                    path: path.join(metaDir, file),
                    siteFolder: subdir.name
                }));
            
            metaFiles.push(...xmlFiles);
        }
    } catch (error) {
        logError(`Error scanning sites directory ${sitesDir}: ${error.message}`);
    }
    
    return metaFiles;
}

/**
 * Fetch attribute group assignments from local meta.xml files
 * Returns same structure as OCAPI getAttributeGroups but from local files
 * @param {string} repoPath - Path to the repository
 * @param {Array<string>} attributeIds - Filter to only include these attribute IDs
 * @returns {Promise<Array<Object>>} Array of group objects with assigned attributes
 */
export async function fetchAttributeGroupsFromMeta(repoPath, attributeIds) {
    const attributeIdSet = new Set(attributeIds);
    const groupMap = new Map();
    const metaFiles = findMetaXmlFiles(repoPath);
    
    if (metaFiles.length === 0) {
        console.log('[!] No meta.xml files found in repository');
        return [];
    }
    
    console.log(`Scanning ${metaFiles.length} meta.xml file(s) for attribute group assignments...`);
    
    for (const { path: metaFilePath, siteFolder } of metaFiles) {
        try {
            const xmlContent = fs.readFileSync(metaFilePath, 'utf-8');
            const parsed = await parseXmlContent(xmlContent);
            const groups = extractAttributeGroupsFromMeta(parsed);
            
            // Merge groups across files, collecting all attributes
            for (const group of groups) {
                const filteredAttributes = group.attributes.filter(id => attributeIdSet.has(id));
                
                if (filteredAttributes.length > 0) {
                    if (!groupMap.has(group.group_id)) {
                        groupMap.set(group.group_id, {
                            group_id: group.group_id,
                            group_display_name: group.group_display_name,
                            attributes: new Set()
                        });
                    }
                    
                    const existingGroup = groupMap.get(group.group_id);
                    filteredAttributes.forEach(attr => existingGroup.attributes.add(attr));
                }
            }
        } catch (error) {
            logError(`Failed to parse ${path.basename(metaFilePath)} in ${siteFolder}: ${error.message}`);
            console.log(`   File: ${metaFilePath}`);
            console.log(`   Skipping this file and continuing...`);
        }
    }
    
    // Convert Map to array and Set to array
    const groupAssignments = Array.from(groupMap.values()).map(group => ({
        group_id: group.group_id,
        group_display_name: group.group_display_name,
        attributes: Array.from(group.attributes)
    }));
    
    console.log(`Found ${groupAssignments.length} group(s) with matching attributes`);
    
    return groupAssignments;
}

/**
 * Search for a specific attribute in meta.xml files and return which groups contain it
 * @param {string} repoPath - Path to the sibling repository
 * @param {string} attributeId - Attribute ID to search for
 * @returns {Promise<Array<Object>>} Array of results with file paths and group IDs
 */
export async function findAttributeInMetaFiles(repoPath, attributeId) {
    const results = [];
    const metaFiles = findMetaXmlFiles(repoPath);
    
    if (metaFiles.length === 0) {
        console.log('[!] No meta.xml files found in repository');
        return results;
    }
    
    for (const { path: metaFilePath, siteFolder } of metaFiles) {
        try {
            const xmlContent = fs.readFileSync(metaFilePath, 'utf-8');
            const parsed = await parseXmlContent(xmlContent);
            const groups = extractAttributeGroupsFromMeta(parsed);
            
            for (const group of groups) {
                const hasAttribute = group.attributes.includes(attributeId) || 
                                   group.attributes.includes(`c_${attributeId}`);
                
                if (hasAttribute) {
                    results.push({
                        filePath: metaFilePath,
                        relativePath: path.relative(repoPath, metaFilePath),
                        siteFolder,
                        groupId: group.group_id,
                        fileName: path.basename(metaFilePath)
                    });
                }
            }
        } catch (error) {
            logError(`Failed to parse ${path.basename(metaFilePath)} in ${siteFolder}: ${error.message}`);
            console.log(`   File: ${metaFilePath}`);
            console.log(`   Skipping this file and continuing...`);
        }
    }
    
    return results;
}
