import { getSiteById, getSitePreferencesGroup } from './api.js';
import { normalizeId, isValueKey } from './helpers.js';

/**
 * Build preference metadata from preference definitions
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

/**
 * Process sites and groups to build usage rows and site summaries
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

/**
 * Build preference matrix: all preferences vs all sites
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
