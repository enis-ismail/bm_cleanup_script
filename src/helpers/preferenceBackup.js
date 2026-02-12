/**
 * Preference Backup Helper
 * Generate rollback backup files for SFCC attribute definitions
 */

import fs from 'fs/promises';
import path from 'path';
import { getAttributeGroups } from '../api.js';

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
function buildCreateSafeBody(attributeDefinition) {
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
 * @returns {Promise<Array>} Array of group objects with assigned attributes
 */
async function fetchAttributeGroupAssignments(objectType, realm, attributeIds) {
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
 * Generate backup file from already-fetched attribute definitions
 * Use this when you already have the full attribute definitions to avoid redundant API calls
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {Array<Object>} attributeDefinitions - Already-fetched attribute definitions
 * @param {string} realm - Realm name for file naming
 * @param {string} instanceType - Instance type for directory structure
 * @returns {Promise<string>} Path to generated backup file
 */
export async function generateBackupFromDefinitions(objectType, attributeDefinitions, realm, instanceType) {
    console.log(`\nGenerating backup file from ${attributeDefinitions.length} attribute definitions...`);

    // Transform to create-safe bodies
    const createSafeAttributes = attributeDefinitions.map(def => buildCreateSafeBody(def));
    const attributeIds = attributeDefinitions.map(def => def.id);

    // Fetch attribute group assignments
    console.log('Fetching attribute group assignments...');
    const groupAssignments = await fetchAttributeGroupAssignments(objectType, realm, attributeIds);
    console.log(`Found ${groupAssignments.length} group(s) with assigned attributes\n`);

    // Build backup structure
    const backup = {
        backup_date: new Date().toISOString(),
        realm,
        instance_type: instanceType,
        object_type: objectType,
        total_attributes: createSafeAttributes.length,
        attributes: createSafeAttributes,
        attribute_groups: groupAssignments
    };

    // Ensure backup directory exists
    const backupDir = path.join(process.cwd(), 'backup', instanceType);
    await fs.mkdir(backupDir, { recursive: true });

    // Generate filename and save
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `${realm}_${objectType}_backup_${timestamp}.json`;
    const filePath = path.join(backupDir, filename);

    await fs.writeFile(filePath, JSON.stringify(backup, null, 2), 'utf-8');

    console.log(`✓ Backup file created: ${filePath}`);
    console.log(`  Total attributes backed up: ${createSafeAttributes.length}`);
    console.log(`  Total groups included: ${groupAssignments.length}\n`);

    return filePath;
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
