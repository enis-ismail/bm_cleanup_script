/**
 * Preference Backup Helper
 * Generate rollback backup files for SFCC attribute definitions
 */

import fs from 'fs/promises';
import path from 'path';
import { getAttributeGroups } from '../api.js';
import { parseCSVToNestedArray } from '../helpers.js';
import { fetchAttributeGroupsFromMeta, getAttributeGroupsFromMetadataFile } from './siteXmlHelper.js';

/**
 * Fields that are valid for creating new attribute definitions
 * All other fields are read-only or system-generated and must be excluded
 */
const CREATE_SAFE_FIELDS = [
    'id',
    'display_name',
    'description',
    'value_type',
    'mandatory',
    'localizable',
    'multi_value_type',
    'visible',
    'queryable',
    'searchable',
    'site_specific',
    'default_value',
    'min_length',
    'max_length',
    'min_value',
    'max_value',
    'value_definitions'
];

/**
 * Transform attribute definition into create-safe body
 * Strips out all read-only and system-generated fields
 * @param {Object} attributeDefinition - Full attribute definition from OCAPI
 * @returns {Object} Create-safe attribute definition
 */
export function buildCreateSafeBody(attributeDefinition) {
    const createSafeBody = {};

    for (const field of CREATE_SAFE_FIELDS) {
        if (attributeDefinition[field] !== undefined) {
            createSafeBody[field] = attributeDefinition[field];
        }
    }

    return createSafeBody;
}

/**
 * Fetch all attribute groups and their attribute assignments
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {string} realm - Realm name
 * @param {Array<string>} attributeIds - List of attribute IDs to filter
 * @param {string} [repoPath] - Optional local repository path for meta.xml parsing
 * @returns {Promise<Array>} Array of group objects with assigned attributes
 */
async function fetchAttributeGroupAssignments(objectType, realm, attributeIds, repoPath = null) {
    // Use local meta.xml files if repository path provided
    if (repoPath) {
        console.log('Using local meta.xml files for group assignments...');
        return await fetchAttributeGroupsFromMeta(repoPath, attributeIds);
    }

    // Fall back to OCAPI
    console.log('Fetching group assignments via OCAPI...');
    const allGroups = await getAttributeGroups(objectType, realm);
    const attributeIdSet = new Set(attributeIds);
    const groupAssignments = [];

    for (const group of allGroups) {
        // Filter to only include attributes from our list
        const assignedAttributes = (group.attribute_definitions || [])
            .map(attr => attr.id)
            .filter(id => attributeIdSet.has(id));

        if (assignedAttributes.length > 0) {
            groupAssignments.push({
                group_id: group.id,
                group_display_name: group.display_name,
                attributes: assignedAttributes
            });
        }
    }

    return groupAssignments;
}

/**
 * Parse site values from usage CSV file
 * @param {string} usageFilePath - Path to usage CSV file
 * @param {Array<string>} attributeIds - Filter to only include these attribute IDs
 * @returns {Object} Map of preferenceId -> { groupId, siteValues: { siteId: value } }
 * @private
 */
function parseSiteValuesFromUsageCSV(usageFilePath, attributeIds) {
    const siteValues = {};
    const attributeIdSet = new Set(attributeIds);

    try {
        const csvData = parseCSVToNestedArray(usageFilePath);
        if (csvData.length === 0) return siteValues;

        const headers = csvData[0];
        const groupIdIndex = headers.indexOf('groupId');
        const preferenceIdIndex = headers.indexOf('preferenceId');

        // Find all value_* columns
        const siteValueColumns = headers
            .map((header, index) => ({ header, index }))
            .filter(({ header }) => header.startsWith('value_'))
            .map(({ header, index }) => ({
                siteId: header.replace('value_', ''),
                index
            }));

        // Parse each row
        for (let i = 1; i < csvData.length; i++) {
            const row = csvData[i];
            const csvPreferenceId = row[preferenceIdIndex];
            const groupId = row[groupIdIndex];

            // Normalize: CSV has "c_ThisTestAttribute" but attributeIds has "ThisTestAttribute"
            // Strip "c_" prefix if present to match against attribute definition IDs
            const normalizedId = csvPreferenceId.startsWith('c_')
                ? csvPreferenceId.substring(2)
                : csvPreferenceId;

            if (!attributeIdSet.has(normalizedId)) continue;

            const siteData = {};
            for (const { siteId, index } of siteValueColumns) {
                const value = row[index];
                if (value && value.trim() !== '') {
                    siteData[siteId] = value;
                }
            }

            // Store using normalized ID (matching attribute definition ID)
            siteValues[normalizedId] = {
                groupId,
                siteValues: siteData
            };
        }
    } catch (error) {
        console.warn(`Warning: Could not parse site values from ${usageFilePath}: ${error.message}`);
    }

    return siteValues;
}

/**
 * Generate backup file from already-fetched attribute definitions
 * Use this when you already have the full attribute definitions to avoid redundant API calls
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {Array<Object>} attributeDefinitions - Already-fetched attribute definitions
 * @param {string} realm - Realm name for file naming
 * @param {string} instanceType - Instance type for directory structure
 * @param {string} [usageFilePath] - Optional path to usage CSV for site values
 * @param {string} [repoPath] - Optional local repository path for meta.xml parsing
 * @returns {Promise<string>} Path to generated backup file
 */
export async function generateBackupFromDefinitions(
    objectType,
    attributeDefinitions,
    realm,
    instanceType,
    usageFilePath = null,
    repoPath = null
) {
    console.log(`\nGenerating backup file from ${attributeDefinitions.length} attribute definitions...`);

    // Transform to create-safe bodies
    const createSafeAttributes = attributeDefinitions.map(def => buildCreateSafeBody(def));
    const attributeIds = attributeDefinitions.map(def => def.id);

    // Fetch attribute group assignments (from meta.xml if repo path provided, otherwise OCAPI)
    const groupAssignments = await fetchAttributeGroupAssignments(objectType, realm, attributeIds, repoPath);
    console.log(`Found ${groupAssignments.length} group(s) with assigned attributes\n`);

    // Parse site values from usage CSV if provided
    let siteValues = {};
    if (usageFilePath) {
        console.log('Extracting site values from usage CSV...');
        siteValues = parseSiteValuesFromUsageCSV(usageFilePath, attributeIds);
        const prefsWithValues = Object.keys(siteValues).length;
        console.log(`Found site values for ${prefsWithValues} preference(s)\n`);
    }

    // Build backup structure
    const backup = {
        backup_date: new Date().toISOString(),
        realm,
        instance_type: instanceType,
        object_type: objectType,
        total_attributes: createSafeAttributes.length,
        attributes: createSafeAttributes,
        attribute_groups: groupAssignments,
        site_values: siteValues
    };

    // Ensure backup directory exists
    const backupDir = path.join(process.cwd(), 'backup', instanceType);
    await fs.mkdir(backupDir, { recursive: true });

    // Generate filename and save
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `${realm}_${objectType}_backup_${timestamp}.json`;
    const filePath = path.join(backupDir, filename);

    // Always overwrite - backup should be regenerated with latest data
    await fs.writeFile(filePath, JSON.stringify(backup, null, 2), 'utf-8');

    console.log(`✓ Backup file created: ${filePath}`);
    console.log(`  Total attributes backed up: ${createSafeAttributes.length}`);
    console.log(`  Total groups included: ${groupAssignments.length}\n`);

    return filePath;
}

/**
 * Update a backup file with attribute group assignments from metadata XML
 * @param {string} backupFilePath - Path to backup JSON
 * @param {string} metadataFilePath - Path to meta_data_backup.xml
 * @param {string} [objectTypeOverride] - Optional object type override
 * @returns {Promise<Object|null>} Summary of updates or null on failure
 */
export async function updateBackupFileAttributeGroups(backupFilePath, metadataFilePath, objectTypeOverride = null) {
    try {
        const backup = await loadBackupFile(backupFilePath);
        const objectType = objectTypeOverride || backup.object_type || 'SitePreferences';
        const attributeIds = backup.attributes.map(attr => attr.id);
        const attributeIdSet = new Set(attributeIds);

        const groups = await getAttributeGroupsFromMetadataFile(metadataFilePath, objectType);
        const filteredGroups = groups
            .map(group => {
                const matched = group.attributes.filter(id => attributeIdSet.has(id));
                if (matched.length === 0) {
                    return null;
                }
                return {
                    group_id: group.group_id,
                    group_display_name: group.group_display_name,
                    attributes: matched
                };
            })
            .filter(Boolean);

        backup.attribute_groups = filteredGroups;

        await fs.writeFile(backupFilePath, JSON.stringify(backup, null, 2), 'utf-8');

        const attributeCount = filteredGroups.reduce((sum, group) => sum + group.attributes.length, 0);

        return {
            filePath: backupFilePath,
            groupCount: filteredGroups.length,
            attributeCount
        };
    } catch (error) {
        console.error(`Failed to update backup file: ${error.message}`);
        return null;
    }
}

/**
 * Check if a backup file exists and get its age in days
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @param {string} objectType - Object type (e.g., "SitePreferences")
 * @returns {Promise<{exists: boolean, filePath: string, ageInDays: number, backup: Object}>} Backup file info
 */
export async function checkBackupFileAge(realm, instanceType, objectType) {
    const backupDir = path.join(process.cwd(), 'backup', instanceType);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `${realm}_${objectType}_backup_${timestamp}.json`;
    const filePath = path.join(backupDir, filename);

    try {
        await fs.access(filePath);
        const backup = await loadBackupFile(filePath);
        const backupDate = new Date(backup.backup_date);
        const now = new Date();
        const ageInDays = Math.floor((now - backupDate) / (1000 * 60 * 60 * 24));

        return {
            exists: true,
            filePath,
            ageInDays,
            backup
        };
    } catch {
        return {
            exists: false,
            filePath,
            ageInDays: null,
            backup: null
        };
    }
}

/**
 * Validate backup file structure
 * @param {string} backupFilePath - Path to backup file
 * @returns {Promise<Object>} Validated backup data
 */
export async function loadBackupFile(backupFilePath) {
    const content = await fs.readFile(backupFilePath, 'utf-8');
    const backup = JSON.parse(content);

    // Validate required fields
    const requiredFields = ['backup_date', 'realm', 'object_type', 'attributes', 'attribute_groups'];
    for (const field of requiredFields) {
        if (!backup[field]) {
            throw new Error(`Invalid backup file: missing required field '${field}'`);
        }
    }

    return backup;
}
