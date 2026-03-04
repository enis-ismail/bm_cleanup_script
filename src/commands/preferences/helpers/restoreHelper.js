import { LOG_PREFIX, IDENTIFIERS } from '../../../config/constants.js';
import { buildCreateSafeBody } from '../../../io/backupUtils.js';
import {
    updateAttributeDefinitionById,
    assignAttributeToGroup,
    getAttributeGroupById,
    createOrUpdateAttributeGroup,
    patchSitePreferencesGroup
} from '../../../api/api.js';

/**
 * Restore a single preference: definition, group assignments, and site values
 * @param {Object} options - Restore options
 * @param {string} options.preferenceId - Preference ID to restore
 * @param {Object} options.backup - Loaded backup object
 * @param {string} options.objectType - Object type (e.g. 'SitePreferences')
 * @param {string} options.instanceType - Instance type (e.g. 'development')
 * @param {string} options.realm - Realm name
 * @param {Set<string>} [options.ensuredGroups] - Cache of group IDs already ensured for this realm run
 * @returns {Promise<boolean>} True if the preference was restored successfully
 */
export async function restorePreference({
    preferenceId,
    backup,
    objectType,
    instanceType,
    realm,
    ensuredGroups = null
}) {
    const attributeToRestore = backup.attributes.find(attr => attr.id === preferenceId);

    if (!attributeToRestore) {
        console.log(`  ${LOG_PREFIX.WARNING} ${preferenceId} not found in backup. Skipping...`);
        return false;
    }

    // Restore attribute definition
    const safeRestoreBody = buildCreateSafeBody(attributeToRestore);
    const restored = await updateAttributeDefinitionById(
        objectType, preferenceId, 'put', safeRestoreBody, realm, instanceType
    );

    if (!restored) {
        console.log(`  ${LOG_PREFIX.ERROR} Failed to restore: ${preferenceId}`);
        return false;
    }

    console.log(`  ${LOG_PREFIX.INFO} Restored: ${preferenceId}`);

    // Restore group assignments (ensure group exists, then assign attribute)
    const groupsToRestore = backup.attribute_groups.filter(group =>
        group.attributes.includes(preferenceId)
    );

    for (const group of groupsToRestore) {
        const alreadyEnsured = ensuredGroups?.has(group.group_id) === true;

        if (!alreadyEnsured) {
            const existingGroup = await getAttributeGroupById(objectType, group.group_id, realm);

            if (!existingGroup) {
                const groupPayload = {
                    display_name: { default: group.group_display_name || group.group_id }
                };
                const groupCreated = await createOrUpdateAttributeGroup(
                    objectType, group.group_id, groupPayload, realm, instanceType
                );

                if (!groupCreated) {
                    console.log(
                        `    ${LOG_PREFIX.ERROR} Failed to ensure group exists: `
                        + `${group.group_id} — skipping assignment`
                    );
                    continue;
                }
            }

            if (ensuredGroups) {
                ensuredGroups.add(group.group_id);
            }
        }

        const assigned = await assignAttributeToGroup(
            objectType, group.group_id, preferenceId, realm, instanceType
        );
        if (assigned) {
            console.log(`    ${LOG_PREFIX.INFO} Assigned to group: ${group.group_id}`);
        } else {
            console.log(`    ${LOG_PREFIX.ERROR} Failed to assign to group: ${group.group_id}`);
        }
    }

    // Restore site-specific values
    const siteValueData = backup.site_values?.[preferenceId];

    if (siteValueData?.siteValues && Object.keys(siteValueData.siteValues).length > 0) {
        const { groupId, siteValues } = siteValueData;
        const attributeKey = preferenceId.startsWith(IDENTIFIERS.CUSTOM_ATTRIBUTE_PREFIX)
            ? preferenceId
            : `${IDENTIFIERS.CUSTOM_ATTRIBUTE_PREFIX}${preferenceId}`;

        for (const [siteId, value] of Object.entries(siteValues)) {
            const payload = { [attributeKey]: value };
            const result = await patchSitePreferencesGroup(siteId, groupId, instanceType, payload, realm);

            if (result) {
                console.log(`    ${LOG_PREFIX.INFO} Restored value for ${siteId}: "${value}"`);
            } else {
                console.log(`    ${LOG_PREFIX.ERROR} Failed to restore value for ${siteId}`);
            }
        }
    }

    return true;
}

/**
 * Restore multiple preferences from a backup file for a single realm
 * @param {Object} options - Restore options
 * @param {string[]} options.preferenceIds - List of preference IDs to restore
 * @param {Object} options.backup - Loaded backup object
 * @param {string} options.objectType - Object type (e.g. 'SitePreferences')
 * @param {string} options.instanceType - Instance type
 * @param {string} options.realm - Realm name
 * @returns {Promise<{restored: number, failed: number}>} Counts of restored/failed preferences
 */
export async function restorePreferencesForRealm({ preferenceIds, backup, objectType, instanceType, realm }) {
    let restored = 0;
    let failed = 0;
    const ensuredGroups = new Set();

    for (const preferenceId of preferenceIds) {
        const success = await restorePreference({
            preferenceId,
            backup,
            objectType,
            instanceType,
            realm,
            ensuredGroups
        });

        if (success) {
            restored++;
        } else {
            failed++;
        }
    }

    console.log(`\n  Realm summary: ${restored} restored, ${failed} failed\n`);
    return { restored, failed };
}
