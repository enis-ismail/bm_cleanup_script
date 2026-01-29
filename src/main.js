import inquirer from 'inquirer';
import { Command } from 'commander';
import path from 'path';
import {
    addRealmToConfig,
    removeRealmFromConfig,
    ensureRealmDir,
    findAllMatrixFiles,
    parseCSVToNestedArray,
    findUnusedPreferences,
    writeUnusedPreferencesFile,
    getSandboxConfig,
    getAvailableRealms
} from './helpers.js';
import { startTimer } from './helpers/timer.js';
import { getSiblingRepositories, findCartridgeFolders } from './helpers/util.js';
import { exportSitesCartridgesToCSV, exportAttributesToCSV, writeUsageCSV, writeMatrixCSV } from './helpers/csv.js';
import {
    getAttributeGroups,
    getAllSites,
    getSitePreferences,
    getSiteById
} from './api.js';
import {
    realmPrompt,
    objectTypePrompt,
    instanceTypePrompt,
    addRealmPrompts,
    selectRealmToRemovePrompt,
    confirmRealmRemovalPrompt,
    scopePrompts,
    repositoryPrompt
} from './prompts.js';
import { buildPreferenceMeta, processSitesAndGroups, buildPreferenceMatrix } from './helpers/summarize.js';
import {
    logCheckPreferencesStart,
    logNoMatrixFiles,
    logMatrixFilesFound,
    logProcessingRealm,
    logEmptyCSV,
    logRealmResults,
    logSummaryHeader,
    logRealmSummary,
    logSummaryFooter
} from './helpers/log.js';
import { compareCartridges, exportComparisonToFile } from './helpers/cartridgeComparison.js';

// ============================================================================
// CLI ENTRYPOINT
// Central command registry for OCAPI tooling
// ============================================================================

const program = new Command();

// Command to list sites and export cartridge paths
program
    .name('OCAPI Tools')
    .description('Tools for working with SFCC OCAPI')
    .version('1.0.0');

// ============================================================================
// CORE COMMANDS
// Primary workflows intended for regular use
// ============================================================================

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
        const answers = await inquirer.prompt([
            ...objectTypePrompt(),
            {
                type: 'confirm',
                name: 'includeDefaults',
                message: 'Include default values? (slower)',
                default: false
            }
        ]);
        const allAttributes = await getSitePreferences(answers.objectType, sandbox, answers.includeDefaults);
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
    .command('summarize-preferences')
    .description('Summarize preference definitions, groups, sites, and filled values across all sites')
    .action(async () => {
        const timer = startTimer();
        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);

        const answers = await inquirer.prompt([
            ...objectTypePrompt('SitePreferences'),
            ...instanceTypePrompt('sandbox'),
            ...scopePrompts(),
            {
                type: 'confirm',
                name: 'includeDefaults',
                message: 'Include default values? (slower)',
                default: false
            }
        ]);

        console.log('\nFetching all preference definitions (attribute definitions)...');
        const preferenceDefinitions = await getSitePreferences(
            answers.objectType,
            sandbox,
            answers.includeDefaults
        );

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
        const preferenceMatrix = buildPreferenceMatrix(
            allPrefIds,
            allSiteIds,
            usageRows,
            preferenceMeta
        );

        // Write CSV with dynamic site-specific value columns
        writeUsageCSV(realmDir, realmAnswers.realm, answers.instanceType, usageRows, preferenceMeta);

        // Write matrix CSV: preferenceId vs sites (X marks usage)
        writeMatrixCSV(realmDir, realmAnswers.realm, answers.instanceType, preferenceMatrix, allSiteIds);

        // Display total runtime
        console.log(`\n✓ Total runtime: ${timer.stop()}`);
    });

program
    .command('check-preferences')
    .description('Check preference usage from matrix files')
    .action(async () => {
        logCheckPreferencesStart();

        const matrixFiles = findAllMatrixFiles();

        if (matrixFiles.length === 0) {
            logNoMatrixFiles();
            return;
        }

        logMatrixFilesFound(matrixFiles.length);

        const summary = [];

        for (const { realm, matrixFile } of matrixFiles) {
            logProcessingRealm(realm);

            const csvData = parseCSVToNestedArray(matrixFile);

            if (csvData.length === 0) {
                logEmptyCSV();
                continue;
            }

            // Find unused preferences
            const unusedPreferences = findUnusedPreferences(csvData);

            // Write unused preferences to file
            const realmDir = path.dirname(matrixFile);
            const outputFile = writeUnusedPreferencesFile(realmDir, realm, unusedPreferences);

            const total = csvData.length - 1; // -1 for header
            logRealmResults(total, unusedPreferences.length, outputFile);

            summary.push({
                realm,
                total,
                unused: unusedPreferences.length,
                used: total - unusedPreferences.length
            });
        }

        // Print summary
        logSummaryHeader();

        for (const stats of summary) {
            logRealmSummary(stats);
        }

        logSummaryFooter();
    });

// ============================================================================
// WIP COMMANDS (Work In Progress)
// Experimental commands being developed
// ============================================================================

program
    .command('validate-cartridges')
    .description('[WIP] Validate cartridge path settings for all sites')
    .action(async () => {
        console.log('\n[WIP] Validating cartridge paths...\n');

        // Get sibling repositories
        const siblings = await getSiblingRepositories();

        if (siblings.length === 0) {
            console.log('No sibling repositories found.');
            return;
        }

        const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));

        const targetPath = path.join(
            path.dirname(process.cwd()),
            siblingAnswers.repository
        );

        const selectedRepo = path.basename(targetPath);
        console.log(`\n✓ Selected: ${selectedRepo}\n`);
        console.log(`Validating cartridges in: ${selectedRepo}\n`);

        // Find cartridge folders in the selected repository
        console.log('Searching for cartridge folders (full depth)...\n');
        const cartridges = findCartridgeFolders(targetPath);

        if (cartridges.length === 0) {
            console.log('No cartridges found in the selected repository.');
            return;
        }

        console.log(`Found ${cartridges.length} unique cartridge(s):\n`);
        for (const cartridge of cartridges) {
            console.log(`  → ${cartridge}`);
        }
        console.log();

        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);

        console.log('Fetching sites...');
        const sites = await getAllSites(sandbox);

        if (sites.length === 0) {
            console.log('No sites found.');
            return;
        }

        console.log(`Fetching detailed cartridge paths for ${sites.length} site(s)...`);

        // Fetch detailed info for each site to get cartridges
        const siteDetails = await Promise.all(
            sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, sandbox))
        );

        const validSites = siteDetails.filter(Boolean).map((site) => {
            const siteId = site.id || site.site_id || site.siteId || 'N/A';
            const cartridges =
                site.cartridges || site.cartridgesPath || site.cartridges_path || 'N/A';
            const cartridgeArray = (typeof cartridges === 'string'
                ? cartridges
                : cartridges?.join(':') || 'N/A'
            ).split(':').filter(Boolean);

            return {
                name: siteId,
                id: siteId,
                cartridges: cartridgeArray
            };
        });

        console.log(`\nCartridge Paths for ${validSites.length} site(s):\n`);

        for (const site of validSites) {
            console.log(`${site.name}:`);
            for (const cartridge of site.cartridges) {
                console.log(`  - ${cartridge}`);
            }
            console.log();
        }

        // Compare discovered cartridges with site cartridges
        const comparisonResult = compareCartridges(cartridges, validSites);

        // Export results to file
        const filePath = await exportComparisonToFile(comparisonResult, realmAnswers.realm);
        console.log(`\n✓ Cartridge comparison saved to: ${filePath}\n`);
    });

program.parse();
