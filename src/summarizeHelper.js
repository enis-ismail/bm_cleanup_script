import { getSiteById, getSitePreferencesGroup } from './api.js';
import { normalizeId, isValueKey } from './helpers.js';


// ============================================================================
// PREFERENCE METADATA CONSTRUCTION
// Transform raw OCAPI attribute definitions into normalized metadata
// ============================================================================

/**
 * Build normalized preference metadata map from OCAPI attribute definitions
 *
 * Purpose: Converts array of OCAPI attribute definition objects into a lookup
 * map indexed by preference ID. Normalizes field names across different OCAPI
 * response formats and extracts key metadata for later use.
 *
 * Process:
 * 1. Iterate through all preference definitions
 * 2. Extract ID from various possible field names (id, attribute_id, attributeId)
 * 3. Normalize other fields (value_type/type, group_id/groupId, etc.)
 * 4. Store in lookup object keyed by preference ID
 *
 * @param {Array} preferenceDefinitions - Array of OCAPI attribute definition objects
 * @returns {Object} Map of preference metadata keyed by preference ID:
 *   {
 *     "c_enableApplePay": {
 *       id: "c_enableApplePay",
 *       type: "boolean",
 *       description: "Enable Apple Pay gateway",
 *       group: "PaymentSettings",
 *       defaultValue: {value: false}
 *     }
 *   }
 *
 * @example
 * const defs = [{id: "c_enableApplePay", value_type: "boolean", group_id: "PaymentSettings"}]
 * const meta = buildPreferenceMeta(defs)
 * // Returns: {"c_enableApplePay": {id: "c_enableApplePay", type: "boolean", group: "PaymentSettings", ...}}
 *
 * Data Flow: Used by summarize-preferences command to enrich usage rows with
 * type information, descriptions, and default values.
 */
export function buildPreferenceMeta(preferenceDefinitions) {
    return preferenceDefinitions.reduce((acc, def) => {
        const id = def.id || def.attribute_id || def.attributeId;
        acc[id] = {
            id,
            type: def.value_type || def.type,
            description: def.description || def.name || null,
            group: def.group_id || def.groupId || null,
            defaultValue: def.default_value || def.default || null
        };
        return acc;
    }, {});
}


// ============================================================================
// SITE AND GROUP PROCESSING
// Fetch and aggregate preference values across sites and groups
// ============================================================================

/**
 * Process all sites and attribute groups to build comprehensive usage data
 *
 * Purpose: Iterates through sites and their preference groups to fetch actual
 * configured values, building both detailed usage rows (for CSV export) and
 * site summaries (for analysis). This is the core data collection step.
 *
 * Process:
 * 1. Loop through each site to process
 * 2. Fetch site details (cartridge path) via getSiteById()
 * 3. For each attribute group, fetch preference values via getSitePreferencesGroup()
 * 4. Filter to only preferences with non-null/empty values
 * 5. Build usage rows with site, group, preference, and value data
 * 6. Accumulate site summaries with group-level value collections
 *
 * @param {Array} sitesToProcess - Array of site objects with id/site_id/siteId fields
 * @param {Array} groupSummaries - Array of group objects with groupId field
 * @param {Object} sandbox - Sandbox configuration object for API calls
 * @param {Object} answers - User input containing instanceType field
 * @param {Object} preferenceMeta - Preference metadata map from buildPreferenceMeta()
 * @returns {Promise<Object>} Object containing:
 *   - usageRows: Array of detailed preference usage objects for CSV export
 *   - siteSummaries: Array of site-level summaries with grouped values
 *
 * @example
 * const result = await processSitesAndGroups(sites, groups, sandbox, {instanceType: "sandbox"}, meta)
 * // Returns: {
 * //   usageRows: [{siteId: "RefArch", preferenceId: "c_enableApplePay", value: "true", ...}],
 * //   siteSummaries: [{siteId: "RefArch", groups: [...]}]
 * // }
 *
 * Data Flow: Usage rows feed into writeUsageCSV() for detailed CSV, and into
 * buildPreferenceMatrix() for the matrix view. Console logs show progress.
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

        console.log(`  - Fetching preference values across ${groupSummaries.length} group(s)...`);
        const groupValues = [];
        let groupIndex = 0;

        for (const group of groupSummaries) {
            groupIndex++;
            console.log(`    [${groupIndex}/${groupSummaries.length}] Group: ${group.groupId}`);
            const sitePrefs = await getSitePreferencesGroup(siteId, group.groupId, answers.instanceType, sandbox);
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
 *
 * Purpose: Creates a 2D matrix structure where rows are preferences and columns
 * are sites, with boolean values indicating whether that preference has a value
 * on that site. Used for "X marks the spot" matrix CSV output.
 *
 * Process:
 * 1. Initialize matrix with all preferences having false for every site
 * 2. Iterate through usage rows (preferences that have values)
 * 3. Mark corresponding preference-site cells as true
 * 4. Return complete matrix structure
 *
 * @param {Array<string>} allPrefIds - Complete list of all preference IDs from definitions
 * @param {Array<string>} allSiteIds - Complete list of all site IDs being processed
 * @param {Array} usageRows - Usage rows from processSitesAndGroups() containing actual values
 * @returns {Array} Array of preference matrix objects:
 *   [
 *     {
 *       preferenceId: "c_enableApplePay",
 *       sites: {
 *         "RefArch": true,
 *         "SiteGenesis": false,
 *         "EU": true
 *       }
 *     }
 *   ]
 *
 * @example
 * const matrix = buildPreferenceMatrix(["c_enableApplePay"], ["RefArch", "EU"], usageRows)
 * // Returns: [{preferenceId: "c_enableApplePay", sites: {RefArch: true, EU: false}}]
 *
 * Data Flow: Matrix is consumed by writeMatrixCSV() which converts boolean values
 * to "X" markers for the preference usage matrix CSV. This matrix is then read by
 * the check-preferences command to identify unused preferences.
 */
export function buildPreferenceMatrix(allPrefIds, allSiteIds, usageRows) {
    // Initialize matrix with all preferences having false for all sites
    const preferenceMatrix = allPrefIds.map(prefId => {
        const siteValues = {};
        allSiteIds.forEach(siteId => {
            siteValues[siteId] = false;
        });
        return { preferenceId: prefId, sites: siteValues };
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
