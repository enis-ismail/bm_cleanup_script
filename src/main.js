import inquirer from 'inquirer';
import { Command } from 'commander';
import { addRealmToConfig, removeRealmFromConfig, ensureRealmDir, writeTestOutput } from './helpers.js';
import { exportSitesCartridgesToCSV, exportAttributesToCSV, writeUsageCSV, writeMatrixCSV } from './csvHelper.js';
import { getSandboxConfig, getAvailableRealms, getSitePreferencesGroup, getAttributeGroups, getAttributeGroupById, getAllSites, getSitePreferences, getPreferencesInGroup, getPreferenceById } from './api.js';
import { realmPrompt, objectTypePrompt, instanceTypePrompt, preferenceGroupPrompt, preferenceIdPrompt, addRealmPrompts, selectRealmToRemovePrompt, confirmRealmRemovalPrompt, attributeGroupSelectionPrompt, siteIdPrompt, scopePrompts } from './prompts.js';
import { buildPreferenceMeta, processSitesAndGroups, buildPreferenceMatrix } from './summarizeHelper.js';

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

        const filename = `${realmAnswers.realm}_attribute_groups_response.json`;
        writeTestOutput(filename, groups, {
            preview: groups[0],
            consoleOutput: true
        });

        console.log(`\nResult: Found ${groups.length} attribute groups`);
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

        console.log('\nResult:');
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

        const logData = {
            request: {
                groupId: answers.groupId,
                instanceType: answers.instanceType,
                endpoint: `/s/-/dw/data/v25_6/site_preferences/preference_groups/${answers.groupId}/${
                    answers.instanceType
                }/preference_search`
            },
            response: preferences
        };
        const filename = `${answers.groupId}_preferences_response.json`;
        writeTestOutput(filename, logData);

        console.log('\nResult: Found preferences in group');
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
        writeTestOutput(filename, logData);
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

        console.log(
            `\nFetching preferences for site: ${answers.siteId}, group: ${answers.groupId}...`
        );
        const preferences = await getSitePreferencesGroup(
            answers.siteId,
            answers.groupId,
            answers.instanceType,
            sandbox
        );

        const logData = {
            request: {
                siteId: answers.siteId,
                groupId: answers.groupId,
                instanceType: answers.instanceType,
                endpoint: `/s/-/dw/data/v25_6/sites/${answers.siteId}/site_preferences/preference_groups/${
                    answers.groupId
                }/${answers.instanceType}`
            },
            response: preferences
        };
        const filename = `${answers.siteId}_${answers.groupId}_site_preferences_response.json`;
        writeTestOutput(filename, logData);

        console.log('\nResult: Retrieved site preferences');
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

        const preferenceMeta = buildPreferenceMeta(preferenceDefinitions);
        const usageRows = [];

        console.log(`\nProcessing ${sitesToProcess.length} site(s)...`);

        const { usageRows: processedRows, siteSummaries: processedSummaries } = await processSitesAndGroups(
            sitesToProcess,
            groupSummaries,
            sandbox,
            answers,
            preferenceMeta
        );

        usageRows.push(...processedRows);
        siteSummaries.push(...processedSummaries);

        const realmDir = ensureRealmDir(realmAnswers.realm);

        // Build complete preference matrix: all preferences vs all sites
        const allSiteIds = sitesToProcess.map(s => s.id || s.site_id || s.siteId).filter(Boolean).sort();
        const allPrefIds = Object.keys(preferenceMeta).sort();
        const preferenceMatrix = buildPreferenceMatrix(allPrefIds, allSiteIds, usageRows);

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
