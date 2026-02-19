import fs from 'fs';
import csv from 'csv-parser';

/**
 * SitePreferences JSON Generator
 *
 * Generates SitePreferences JSON from:
 * - Unused preferences list file
 * - Preference usage CSV with metadata and locale values
 * - XML metadata file with group assignments
 *
 * Can be used as:
 * 1. CLI: node generateSitePreferencesJSON.js
 * 2. Module: import { generate } from './generateSitePreferences.js'
 */

// Type mapping for value_type field
const TYPE_MAP = {
    'boolean': 'boolean',
    'string': 'string',
    'text': 'text',
    'int': 'int',
    'double': 'double',
    'set_of_string': 'set_of_string',
    'enum_of_string': 'enum_of_string'
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    unusedPreferencesFile: './sandbox_unused_preferences.txt',
    csvFile: './bcwr-080_sandbox_preferences_usage.csv',
    xmlMetadataFile: './sandbox_bcwr-080_meta_data_backup.xml',
    outputFile: './bcwr-080_SitePreferences_generated.json',
    realm: 'bcwr-080',
    instanceType: 'sandbox',
    objectType: 'SitePreferences',
    verbose: true
};

/**
 * Logger utility
 */
function createLogger(verbose = true) {
    return {
        info: (msg) => verbose && console.log(`✓ ${msg}`),
        error: (msg) => console.error(`❌ ${msg}`),
        warn: (msg) => verbose && console.warn(`⚠️  ${msg}`),
        section: (msg) => verbose && console.log(`\n${msg}`),
        success: (msg) => verbose && console.log(`✓ ${msg}`),
        data: (msg) => verbose && console.log(msg)
    };
}

/**
 * Parse the unused preferences file to extract all preference IDs
 * @param {string} filePath - Path to unused preferences file
 * @returns {string[]} Array of preference IDs
 */
function parseUnusedPreferences(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const sectionMarkers = [
        '--- Preference IDs ---',
        '--- Preferences for Deletion ---'
    ];
    const startIdx = lines.findIndex(line =>
        sectionMarkers.some(marker => line.includes(marker))
    );

    const prefIds = [];
    if (startIdx !== -1) {
        for (let i = startIdx + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('---')) {
                prefIds.push(line);
            }
        }
        return prefIds;
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('---')) {
            continue;
        }
        if (/^[A-Za-z0-9_]+$/.test(trimmed)) {
            prefIds.push(trimmed);
        }
    }

    return prefIds;
}

/**
 * Parse XML metadata file to extract group assignments
 * @param {string} filePath - Path to XML metadata file
 * @param {Object} logger - Logger utility object
 * @returns {Object} Map of preference ID to group ID
 */
function parseXMLGroupDefinitions(filePath, logger = createLogger(false)) {
    if (!fs.existsSync(filePath)) {
        logger.warn(`XML metadata file not found: ${filePath}`);
        return {};
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const groupMap = {};

    // Find SitePreferences type-extension
    const sitePrefsMatch = content.indexOf('<type-extension type-id="SitePreferences">');
    if (sitePrefsMatch === -1) {
        logger.warn('Could not find SitePreferences type-extension in XML');
        return groupMap;
    }

    // Find the end of this type-extension
    const nextTypeExtension = content.indexOf('<type-extension', sitePrefsMatch + 1);
    const sitePrefsSection = nextTypeExtension > -1
        ? content.substring(sitePrefsMatch, nextTypeExtension)
        : content.substring(sitePrefsMatch);

    // Find group-definitions section
    const groupDefsStart = sitePrefsSection.indexOf('<group-definitions>');
    const groupDefsEnd = sitePrefsSection.indexOf('</group-definitions>');

    if (groupDefsStart === -1 || groupDefsEnd === -1) {
        logger.warn('Could not find group-definitions section');
        return groupMap;
    }

    const groupDefsSection = sitePrefsSection.substring(groupDefsStart, groupDefsEnd);

    // Parse attribute-group elements
    const groupRegex = /<attribute-group group-id="([^"]+)">([\s\S]*?)<\/attribute-group>/g;
    let groupMatch;

    while ((groupMatch = groupRegex.exec(groupDefsSection)) !== null) {
        const groupId = groupMatch[1];
        const groupContent = groupMatch[2];

        // Extract attribute IDs from this group
        const attrRegex = /<attribute attribute-id="([^"]+)"\/?>/g;
        let attrMatch;

        while ((attrMatch = attrRegex.exec(groupContent)) !== null) {
            const attrId = attrMatch[1];
            groupMap[attrId] = groupId;
        }
    }

    logger.info(`Extracted ${Object.keys(groupMap).length} preference-to-group mappings from XML`);
    return groupMap;
}

/**
 * Read CSV and build preference data lookup
 * Dynamically discovers locale columns from headers with 'value_' prefix
 * @param {string} filePath - Path to CSV file
 * @param {Object} logger - Logger utility object
 * @returns {Promise<Object>} Preferences lookup object
 */
function readCSVData(filePath, logger = createLogger(false)) {
    return new Promise((resolve, reject) => {
        const preferences = {};
        let localeMap = {};
        let count = 0;
        let headerProcessed = false;

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('headers', (headers) => {
                // Dynamically build locale map from column headers
                localeMap = {};
                for (const header of headers) {
                    if (header.startsWith('value_')) {
                        const locale = header.split('_')[1];
                        localeMap[header] = locale;
                    }
                }
                logger.info(`Discovered ${Object.keys(localeMap).length} locales: ${Object.values(localeMap).join(', ')}`);
                headerProcessed = true;
            })
            .on('data', (row) => {
                if (row.preferenceId && headerProcessed) {
                    const prefId = row.preferenceId.replace(/"/g, '').trim();

                    if (!preferences[prefId]) {
                        preferences[prefId] = {
                            groupId: row.groupId?.replace(/"/g, '').trim() || '',
                            preferenceId: prefId,
                            defaultValue: row.defaultValue?.replace(/"/g, '').trim() || '',
                            description: row.description?.replace(/"/g, '').trim() || '',
                            type: row.type?.replace(/"/g, '').trim() || 'string',
                            values: {}
                        };

                        // Extract locale values using dynamically discovered locale map
                        for (const [csvCol, locale] of Object.entries(localeMap)) {
                            const value = row[csvCol];
                            if (value && value.trim() && value !== '""' && value !== '') {
                                // Remove quotes if present
                                const cleanValue = value.replace(/^"+|"+$/g, '').trim();
                                // Only store non-empty values
                                if (cleanValue && cleanValue !== '') {
                                    preferences[prefId].values[locale] = cleanValue;
                                }
                            }
                        }
                    }
                    count++;
                }
            })
            .on('end', () => {
                logger.info(`Parsed ${count} CSV rows`);
                resolve(preferences);
            })
            .on('error', reject);
    });
}

/**
 * Generate the full SitePreferences JSON structure
 * @param {string[]} unusedPrefIds - Array of preference IDs
 * @param {Object} csvData - CSV data lookup
 * @param {Object} groupMap - Map of preference ID to group ID from XML
 * @param {Object} config - Configuration object
 * @returns {Object} Generated structure with result, csvMatches, minimal counts
 */
function generateSitePreferencesJSON(unusedPrefIds, csvData, groupMap, config = {}) {
    const attributes = [];
    const attributeGroups = {};
    const siteValues = {};
    let csvMatches = 0;
    let minimal = 0;

    // Process each unused preference
    for (const prefId of unusedPrefIds) {
        const pref = csvData[prefId];
        const hasCSVData = prefId in csvData;

        if (hasCSVData) {
            csvMatches++;
            // Add to attributes list with full CSV data
            attributes.push({
                id: prefId,
                display_name: {
                    default: prefId
                },
                description: {
                    default: pref.description
                },
                value_type: TYPE_MAP[pref.type] || 'string',
                default_value: {
                    value: pref.defaultValue
                },
                mandatory: false,
                localizable: false,
                multi_value_type: pref.type === 'set_of_string' || pref.type === 'enum_of_string',
                visible: false,
                queryable: true,
                searchable: false,
                site_specific: false,
                min_length: 0
            });

            // Add to attribute groups using XML group mapping
            const groupId = groupMap[prefId] || pref.groupId || 'General';
            if (!attributeGroups[groupId]) {
                attributeGroups[groupId] = {
                    group_id: groupId,
                    group_display_name: groupId,
                    attributes: []
                };
            }
            attributeGroups[groupId].attributes.push(prefId);

            // Add site values if any exist
            if (Object.keys(pref.values).length > 0) {
                siteValues[prefId] = {
                    groupId: pref.groupId,
                    siteValues: pref.values
                };
            }
        } else {
            minimal++;
            // Create minimal valid object for preferences not in CSV
            const valueType = 'string';
            let defaultVal = '';

            // Set type-appropriate default values
            if (valueType === 'boolean') {
                defaultVal = false;
            } else if (valueType === 'int' || valueType === 'double') {
                defaultVal = 0;
            } else if (valueType === 'set_of_string' || valueType === 'enum_of_string') {
                defaultVal = [];
            }

            attributes.push({
                id: prefId,
                display_name: {
                    default: prefId
                },
                description: {
                    default: ''
                },
                value_type: valueType,
                default_value: {
                    value: defaultVal
                },
                mandatory: false,
                localizable: false,
                multi_value_type: false,
                visible: false,
                queryable: true,
                searchable: false,
                site_specific: false,
                min_length: 0
            });

            // Only assign to group if found in XML metadata
            if (groupMap[prefId]) {
                const groupId = groupMap[prefId];
                if (!attributeGroups[groupId]) {
                    attributeGroups[groupId] = {
                        group_id: groupId,
                        group_display_name: groupId,
                        attributes: []
                    };
                }
                attributeGroups[groupId].attributes.push(prefId);
            }
        }
    }

    // Build final JSON structure
    const result = {
        backup_date: new Date().toISOString(),
        realm: config.realm || 'bcwr-080',
        instance_type: config.instanceType || 'sandbox',
        object_type: config.objectType || 'SitePreferences',
        total_attributes: attributes.length,
        attributes: attributes,
        attribute_groups: Object.values(attributeGroups),
        site_values: siteValues
    };

    return { result, csvMatches, minimal };
}

/**
 * Main generate function
 * Can optionally write to file or return data
 * @param {Object} userConfig - User configuration object
 * @returns {Promise<Object>} Generated data and statistics
 */
async function generate(userConfig = {}) {
    // Merge user config with defaults
    const config = { ...DEFAULT_CONFIG, ...userConfig };
    const logger = createLogger(config.verbose);

    try {
        logger.section('📋 Reading unused preferences...');
        const unusedPrefIds = parseUnusedPreferences(config.unusedPreferencesFile);
        logger.info(`Found ${unusedPrefIds.length} unused preference IDs`);

        logger.section('📖 Reading CSV data...');
        let csvData = {};
        if (config.csvFile && fs.existsSync(config.csvFile)) {
            csvData = await readCSVData(config.csvFile, logger);
            logger.info(`Found ${Object.keys(csvData).length} preferences in CSV`);
        } else {
            logger.warn(`CSV file not found: ${config.csvFile || '(none)'}. Proceeding without site values.`);
        }

        logger.section('🗂️  Parsing XML group definitions...');
        const groupMap = parseXMLGroupDefinitions(config.xmlMetadataFile, logger);
        logger.info(`Found group mappings for ${Object.keys(groupMap).length} preferences`);

        logger.section('🔗 Matching unused preferences with CSV data...');
        const matchedCount = unusedPrefIds.filter(id => id in csvData).length;
        logger.info(`Matched ${matchedCount} out of ${unusedPrefIds.length} preferences`);

        if (matchedCount === 0) {
            logger.warn('No matches found! Verify preference IDs match CSV data.');
        }

        logger.section('🏗️  Generating JSON structure...');
        const { result, csvMatches, minimal } = generateSitePreferencesJSON(unusedPrefIds, csvData, groupMap, config);

        // Write to file if outputFile is specified
        if (config.outputFile) {
            logger.section('💾 Writing output file...');
            fs.writeFileSync(config.outputFile, JSON.stringify(result, null, 2));
            logger.success(`Output saved to: ${config.outputFile}`);
        }

        logger.section('📊 Summary');
        logger.data(`  - Total attributes generated: ${result.total_attributes}`);
        logger.data(`    - From CSV data: ${csvMatches}`);
        logger.data(`    - Minimal (no CSV data): ${minimal}`);
        logger.data(`  - Attribute groups: ${result.attribute_groups.length}`);
        logger.data(`  - Preferences with site values: ${Object.keys(result.site_values).length}`);

        return {
            success: true,
            data: result,
            stats: {
                total: result.total_attributes,
                fromCsv: csvMatches,
                minimal,
                groups: result.attribute_groups.length,
                withValues: Object.keys(result.site_values).length
            },
            outputPath: config.outputFile
        };

    } catch (error) {
        logger.error(error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Export for use as module
export {
    generate,
    generateSitePreferencesJSON,
    readCSVData,
    parseUnusedPreferences,
    parseXMLGroupDefinitions,
    createLogger,
    DEFAULT_CONFIG
};
