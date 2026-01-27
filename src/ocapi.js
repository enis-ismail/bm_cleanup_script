import inquirer from 'inquirer';
import { Command } from 'commander';
import { addRealmToConfig, removeRealmFromConfig, ensureRealmDir } from './helpers.js';
import { exportSitesCartridgesToCSV, exportAttributesToCSV, writeUsageCSV, writeMatrixCSV } from './csvHelper.js';
import { getSandboxConfig, getAvailableRealms, getSitePreferencesGroup, getAttributeGroups, getAttributeGroupById, getAllSites, getSiteById, getSitePreferences, getPreferencesInGroup, getPreferenceById } from './api.js';
import { realmPrompt, objectTypePrompt, instanceTypePrompt, preferenceGroupPrompt, preferenceIdPrompt, addRealmPrompts, selectRealmToRemovePrompt, confirmRealmRemovalPrompt, attributeGroupSelectionPrompt, siteIdPrompt, scopePrompts } from './prompts.js';
import fs from 'fs';

const program = new Command();

// Command to list sites and export cartridge paths
program
    .name('OCAPI Tools')
    .description('Tools for working with SFCC OCAPI')
    .version('1.0.0');

program
    .command('list-sites')
    .description('List all sites and export cartridge paths to CSV')
    .action(async () => {
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);
        await exportSitesCartridgesToCSV(sandbox);
    });

program
    .command('get-preferences')
    .description('Retrieve site preferences from OCAPI')
    .action(async () => {
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);
        const answers = await inquirer.prompt(objectTypePrompt());
        const allAttributes = await getSitePreferences(answers.objectType, sandbox);
        await exportAttributesToCSV(allAttributes, sandbox.hostname);
    });

program
    .command('add-realm')
    .description('Add a new realm to config.json')
    .action(async () => {
        const answers = await inquirer.prompt(addRealmPrompts());
        addRealmToConfig(answers.name, answers.hostname, answers.clientId, answers.clientSecret);
    });

program
    .command('remove-realm')
    .description('Remove a realm from config.json')
    .action(async () => {
        const realms = getAvailableRealms();
        if (realms.length === 0) {
            console.log('No realms available to remove.');
            return;
        }
        
        const selectAnswer = await inquirer.prompt(selectRealmToRemovePrompt(realms));
        const confirmAnswer = await inquirer.prompt(confirmRealmRemovalPrompt(selectAnswer.realmToRemove));
        
        if (confirmAnswer.confirm) {
            await removeRealmFromConfig(selectAnswer.realmToRemove);
        } else {
            console.log('Realm removal cancelled.');
        }
    });

program
    .command('test-attribute-groups')
    .description('[TEMP] Test the attribute groups endpoint')
    .action(async () => {
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);
        const answers = await inquirer.prompt(objectTypePrompt());
        
        console.log(`\nFetching attribute groups for ${answers.objectType}...`);
        const groups = await getAttributeGroups(answers.objectType, sandbox);
        
        // Write full response to file
        const filename = `${realmAnswers.realm}_attribute_groups_response.json`;
        fs.writeFileSync(filename, JSON.stringify(groups, null, 2));
        
        console.log(`\nResult: Found ${groups.length} attribute groups`);
        console.log(`Full response written to ${filename}`);
        console.log('\nFirst group sample:');
        console.log(JSON.stringify(groups[0], null, 2));
    });

program
    .command('test-attribute-group-by-id')
    .description('[TEMP] Test getting a specific attribute group by ID')
    .action(async () => {
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);
        const answers = await inquirer.prompt(objectTypePrompt());
        
        // First fetch all groups to let user pick one
        console.log(`\nFetching attribute groups for ${answers.objectType}...`);
        const groups = await getAttributeGroups(answers.objectType, sandbox);
        
        const groupAnswer = await inquirer.prompt(attributeGroupSelectionPrompt(groups));
        
        console.log(`\nFetching details for attribute group: ${groupAnswer.groupId}...`);
        const group = await getAttributeGroupById(answers.objectType, groupAnswer.groupId, sandbox);
        
        console.log(`\nResult:`);
        console.log(JSON.stringify(group, null, 2));
    });

program
    .command('test-preference-search')
    .description('[TEMP] Test the preference search endpoint with 2C2P group')
    .action(async () => {
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);
        const answers = await inquirer.prompt([
            ...preferenceGroupPrompt('2C2P'),
            ...instanceTypePrompt('sandbox')
        ]);
        
        console.log(`\nFetching preferences for group: ${answers.groupId}...`);
        const preferences = await getPreferencesInGroup(answers.groupId, answers.instanceType, sandbox);
        
        // Log full response to file
        const logData = {
            request: {
                groupId: answers.groupId,
                instanceType: answers.instanceType,
                endpoint: `/s/-/dw/data/v25_6/site_preferences/preference_groups/${answers.groupId}/${answers.instanceType}/preference_search`
            },
            response: preferences
        };
        const filename = `${answers.groupId}_preferences_response.json`;
        fs.writeFileSync(filename, JSON.stringify(logData, null, 2));
        
        console.log(`\nResult: Found preferences in group`);
        console.log(`Full response logged to: ${filename}`);
        console.log(JSON.stringify(preferences, null, 2));
    });

program
    .command('test-preference-by-id')
    .description('[TEMP] Fetch a single preference by ID')
    .action(async () => {
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);
        const answers = await inquirer.prompt([
            ...preferenceIdPrompt(),
            ...instanceTypePrompt('sandbox')
        ]);

        console.log(`\nSearching preference ID: ${answers.preferenceId}...`);
        const preference = await getPreferenceById(answers.preferenceId, answers.instanceType, sandbox);

        const logData = {
            request: {
                preferenceId: answers.preferenceId,
                instanceType: answers.instanceType,
                endpoint: `/s/-/dw/data/v25_6/site_preferences/preference_search/${answers.instanceType}`
            },
            response: preference
        };
        const filename = `${answers.preferenceId}_preference_response.json`;
        fs.writeFileSync(filename, JSON.stringify(logData, null, 2));
        console.log(`\nResult written to ${filename}`);
        console.log(JSON.stringify(preference, null, 2));
    });

program
    .command('test-site-preferences-group')
    .description('[TEMP] Test the site preferences group endpoint')
    .action(async () => {
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);
        
        const answers = await inquirer.prompt([
            ...siteIdPrompt(),
            ...preferenceGroupPrompt('2C2P'),
            ...instanceTypePrompt('sandbox')
        ]);
        
        console.log(`\nFetching preferences for site: ${answers.siteId}, group: ${answers.groupId}...`);
        const preferences = await getSitePreferencesGroup(answers.siteId, answers.groupId, answers.instanceType, sandbox);
        
        // Log full response to file
        const logData = {
            request: {
                siteId: answers.siteId,
                groupId: answers.groupId,
                instanceType: answers.instanceType,
                endpoint: `/s/-/dw/data/v25_6/sites/${answers.siteId}/site_preferences/preference_groups/${answers.groupId}/${answers.instanceType}`
            },
            response: preferences
        };
        const filename = `${answers.siteId}_${answers.groupId}_site_preferences_response.json`;
        fs.writeFileSync(filename, JSON.stringify(logData, null, 2));
        
        console.log(`\nResult: Retrieved site preferences`);
        console.log(`Full response logged to: ${filename}`);
        console.log(JSON.stringify(preferences, null, 2));
    });

program
    .command('summarize-preferences')
    .description('Summarize preference definitions, groups, sites, and filled values across all sites')
    .action(async () => {
        const startTime = Date.now();
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);

        const answers = await inquirer.prompt([
            ...objectTypePrompt('SitePreferences'),
            ...instanceTypePrompt('sandbox'),
            ...scopePrompts()
        ]);

        console.log('\nFetching all preference definitions (attribute definitions)...');
        const preferenceDefinitions = await getSitePreferences(answers.objectType, sandbox);

        console.log('\nFetching preference groups (no assignments, just IDs)...');
        const groups = await getAttributeGroups(answers.objectType, sandbox);
        const groupSummaries = groups.map(g => ({
            groupId: g.id,
            groupName: g.name || g.id,
            displayName: g.display_name || g.displayname || g.id
        }));

        console.log('\nFetching sites and cartridge paths...');
        const sites = await getAllSites(sandbox);
        const sitesToProcess = answers.scope === 'single'
            ? sites.filter(s => (s.id || s.site_id || s.siteId) === answers.siteId)
            : sites;

        if (answers.scope === 'single' && sitesToProcess.length === 0) {
            console.log(`No site found matching '${answers.siteId}'. Aborting.`);
            return;
        }

        const siteSummaries = [];

        const preferenceMeta = preferenceDefinitions.reduce((acc, def) => {
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

        const isValueKey = (key) => !['_v', '_type', 'link', 'site'].includes(key);

        // Helper to normalize preference IDs (remove 'c_' prefix if present)
        const normalizeId = (id) => id?.startsWith('c_') ? id.substring(2) : id;

        const usageRows = [];

        console.log(`\nProcessing ${sitesToProcess.length} site(s)...`);
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

            console.log(`  ✓ Site ${siteId} complete (${usageRows.filter(r => r.siteId === siteId).length} preferences found)`);
            siteSummaries.push({ siteId, cartridges, groups: groupValues });
        }

        const realmDir = ensureRealmDir(realmAnswers.realm);

        // Build complete preference matrix: all preferences vs all sites
        const allSiteIds = sitesToProcess.map(s => s.id || s.site_id || s.siteId).filter(Boolean).sort();
        const allPrefIds = Object.keys(preferenceMeta).sort();

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

        // Write CSV with dynamic site-specific value columns
        writeUsageCSV(realmDir, realmAnswers.realm, answers.instanceType, usageRows, preferenceMeta);

        // Write matrix CSV: preferenceId vs sites (X marks usage)
        writeMatrixCSV(realmDir, realmAnswers.realm, answers.instanceType, preferenceMatrix, allSiteIds);

        // Display total runtime
        const endTime = Date.now();
        const totalSeconds = Math.round((endTime - startTime) / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        console.log(`\n✓ Total runtime: ${timeDisplay}`);
    });

program.parse();
