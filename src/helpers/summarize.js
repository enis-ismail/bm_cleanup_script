import { getSiteById, getSitePreferencesGroup } from '../api.js';
import { normalizeId, isValueKey } from '../helpers.js';
import { processBatch } from './batch.js';
import { startTimer } from './timer.js';


// ============================================================================
// PREFERENCE METADATA CONSTRUCTION
// Transform raw OCAPI attribute definitions into normalized metadata
// ============================================================================

/**
 * Build normalized preference metadata map from OCAPI attribute definitions
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Array} preferenceDefinitions - Array of OCAPI attribute definition objects
 * @returns {Object} Map of preference metadata keyed by preference ID
 */
export function buildPreferenceMeta(preferenceDefinitions) {
    return preferenceDefinitions.reduce((acc, def) => {
        const id = def.id || def.attribute_id || def.attributeId;

        // Extract and normalize default_value
        let defaultValue = extractDefaultValue(def);

        acc[id] = {
            id,
            type: def.value_type || def.type,
            description: def.description || def.name || null,
            group: def.group_id || def.groupId || null,
            defaultValue
        };
        return acc;
    }, {});
}

/**
 * Extract and normalize default value from attribute definition
 * Handles various formats: string, number, boolean, object with value property
 * @param {Object} def - Attribute definition object
 * @returns {string|null} Normalized default value or null if none found
 */
function extractDefaultValue(def) {
    let val = def.default_value !== undefined ? def.default_value : (def.default ?? null);
    
    if (val === null) return null;
    
    // If it's already a primitive, return it
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        // Filter out type descriptors and placeholder strings
        const strVal = String(val).toLowerCase();
        if (strVal === 'object_attribute_value_definition' || 
            strVal === 'null' || 
            strVal === '[object object]') {
            return null;
        }
        return String(val);
    }
    
    // If it's an object, try to extract meaningful value
    if (typeof val === 'object' && val !== null) {
        // Check for value property explicitly (don't use || for falsy values like false or 0)
        if ('value' in val && val.value !== undefined && val.value !== null) {
            const nested = String(val.value).toLowerCase();
            if (nested === 'object_attribute_value_definition' || nested === 'null') {
                return null;
            }
            return String(val.value);
        }
        // Try id property for enum values
        if ('id' in val && val.id !== undefined && val.id !== null) {
            const idStr = String(val.id).toLowerCase();
            if (idStr === 'object_attribute_value_definition' || idStr === 'null') {
                return null;
            }
            return String(val.id);
        }
        // Try first non-empty value in object (skipping metadata)
        for (const key in val) {
            if (key !== '_type' && key !== '_resource_state' && key !== 'value' && key !== 'id' && 
                key !== 'position' && val[key] !== undefined && val[key] !== null) {
                const strVal = String(val[key]).toLowerCase();
                if (strVal !== 'object_attribute_value_definition' && strVal !== 'null' && strVal !== '[object object]') {
                    return String(val[key]);
                }
            }
        }
    }
    
    return null;
}


// ============================================================================
// SITE AND GROUP PROCESSING
// Fetch and aggregate preference values across sites and groups
// ============================================================================

/**
 * Process all sites and attribute groups to build comprehensive usage data
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Array} sitesToProcess - Array of site objects
 * @param {Array} groupSummaries - Array of group objects
 * @param {Object} sandbox - Sandbox configuration object
 * @param {Object} answers - User input containing instanceType field
 * @param {Object} preferenceMeta - Preference metadata map
 * @returns {Promise<Object>} Object with usageRows and siteSummaries
 */
export async function processSitesAndGroups(sitesToProcess, groupSummaries, sandbox, answers, preferenceMeta) {
    const usageRows = [];
    const siteSummaries = [];
    let siteIndex = 0;

    for (const site of sitesToProcess) {
        const siteId = site.id || site.site_id || site.siteId;
        if (!siteId) continue;

        siteIndex++;
        console.log(`\n[${siteIndex}/${sitesToProcess.length}] Processing site: ${siteId}`);

        const siteDetail = await getSiteById(siteId, sandbox);
        const cartridges = siteDetail?.cartridges || siteDetail?.cartridgesPath || siteDetail?.cartridges_path || '';

        console.log(`  - Fetching preference values across ${groupSummaries.length} group(s) in batches...`);
        const groupTimer = startTimer();

        // Fetch groups in parallel batches
        const groupResponses = await processBatch(
            groupSummaries,
            (group) => getSitePreferencesGroup(siteId, group.groupId, answers.instanceType, sandbox),
            20, // Process 20 groups in parallel
            (progress, total, rate) => {
                console.log(
                    `    Fetched ${progress} of ${total} groups ` +
                    `(${rate.toFixed(1)} groups/sec)...`
                );
            },
            200 // 200ms delay between batches
        );

        console.log(`  - Groups fetched in ${groupTimer.stop()}`);
        const groupValues = [];

        // Process fetched group data to extract preference values
        for (let i = 0; i < groupSummaries.length; i++) {
            const group = groupSummaries[i];
            const sitePrefs = groupResponses[i];
            const usedPreferenceIds = Object.keys(sitePrefs || {}).filter(isValueKey);

            // Capture rows for any preferences that have values on this site
            for (const prefId of usedPreferenceIds) {
                const rawVal = sitePrefs[prefId];
                // Only include if value is not null, undefined, or empty string
                if (rawVal === null || rawVal === undefined || rawVal === '') continue;

                const normalizedPrefId = normalizeId(prefId);
                const safeVal = typeof rawVal === 'object' ? JSON.stringify(rawVal) : String(rawVal);
                const meta = preferenceMeta[normalizedPrefId] || {};
                usageRows.push({
                    siteId,
                    cartridges,
                    groupId: group.groupId,
                    preferenceId: normalizedPrefId,
                    hasValue: true,
                    value: safeVal,
                    defaultValue: meta.defaultValue ?? '',
                    description: meta.description ?? ''
                });
            }

            groupValues.push({
                groupId: group.groupId,
                usedPreferenceIds,
                values: sitePrefs
            });
        }

        const sitePrefsCount = usageRows.filter(r => r.siteId === siteId).length;
        console.log(`  ✓ Site ${siteId} complete (${sitePrefsCount} preferences found)`);
        siteSummaries.push({ siteId, cartridges, groups: groupValues });
    }

    return { usageRows, siteSummaries };
}


// ============================================================================
// PREFERENCE MATRIX GENERATION
// Create cross-reference matrix of all preferences across all sites
// ============================================================================

/**
 * Build boolean matrix showing which preferences are used on which sites
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Array<string>} allPrefIds - Complete list of all preference IDs
 * @param {Array<string>} allSiteIds - Complete list of all site IDs
 * @param {Array} usageRows - Usage rows containing actual values
 * @param {Object} preferenceMeta - Preference metadata including default values
 * @returns {Array} Array of preference matrix objects with sites mapping
 */
export function buildPreferenceMatrix(
    allPrefIds,
    allSiteIds,
    usageRows,
    preferenceMeta
) {
    // Initialize matrix with all preferences having false for all sites
    const preferenceMatrix = allPrefIds.map(prefId => {
        const siteValues = {};
        allSiteIds.forEach(siteId => {
            siteValues[siteId] = false;
        });
        return {
            preferenceId: prefId,
            defaultValue: preferenceMeta[prefId]?.defaultValue || '',
            sites: siteValues
        };
    });

    // Mark hasValue=true for preferences that have explicit values
    for (const row of usageRows) {
        const prefEntry = preferenceMatrix.find(p => p.preferenceId === row.preferenceId);
        if (prefEntry) {
            prefEntry.sites[row.siteId] = true;
        }
    }

    return preferenceMatrix;
}
