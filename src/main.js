import inquirer from 'inquirer';
import { Command } from 'commander';
import path from 'path';
import {
    addRealmToConfig,
    removeRealmFromConfig,
    findAllMatrixFiles,
    getSandboxConfig,
    getAvailableRealms,
    getRealmConfig
} from './helpers.js';
import { startTimer } from './helpers/timer.js';
import { getSiblingRepositories, findCartridgeFolders, transformSiteToCartridgeInfo, calculateValidationStats } from './helpers/util.js';
import { exportSitesCartridgesToCSV, exportAttributesToCSV } from './helpers/csv.js';
import {
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
    repositoryPrompt,
    includeDefaultsPrompt
} from './prompts.js';
import {
    logCheckPreferencesStart,
    logNoMatrixFiles,
    logMatrixFilesFound,
    logSummaryHeader,
    logRealmSummary,
    logSummaryFooter,
    logCartridgeValidationSummaryHeader,
    logRealmsProcessed,
    logCartridgeValidationStats,
    logCartridgeValidationWarning,
    logCartridgeValidationSummaryFooter,
    logSiteXmlValidationSummary
} from './helpers/log.js';
import { compareCartridges, exportComparisonToFile } from './helpers/cartridgeComparison.js';
import {
    findSiteXmlFiles,
    parseSiteXml,
    compareSiteXmlWithLive,
    exportSiteXmlComparison
} from './helpers/siteXmlHelper.js';
import { processPreferenceMatrixFiles, executePreferenceSummarization } from './helpers/preferenceHelper.js';

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
            ...includeDefaultsPrompt()
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

        const answers = await inquirer.prompt([
            ...objectTypePrompt('SitePreferences'),
            ...instanceTypePrompt('sandbox'),
            ...scopePrompts(),
            ...includeDefaultsPrompt()
        ]);

        await executePreferenceSummarization({
            realm: realmAnswers.realm,
            objectType: answers.objectType,
            instanceType: answers.instanceType,
            scope: answers.scope,
            siteId: answers.siteId,
            includeDefaults: answers.includeDefaults
        });

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

        const summary = await processPreferenceMatrixFiles(matrixFiles);

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

        const validSites = siteDetails.filter(Boolean).map((site) =>
            transformSiteToCartridgeInfo(site)
        );

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

program
    .command('validate-cartridges-all')
    .description('[WIP] Validate cartridges across ALL configured realms (parallel)')
    .action(async () => {
        console.log('\n[WIP] Validating cartridge paths across all realms...\n');

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

        console.log(`Found ${cartridges.length} unique cartridge(s)\n`);

        // Get all available realms
        const availableRealms = getAvailableRealms();

        if (availableRealms.length === 0) {
            console.log('No realms configured.');
            return;
        }

        console.log(`Fetching sites from ${availableRealms.length} realm(s) in parallel...\n`);

        // Fetch sites from all realms in parallel
        const realmPromises = availableRealms.map(async (realmName) => {
            try {
                console.log(`[${realmName}] Fetching sites...`);
                const sandbox = getSandboxConfig(realmName);
                const sites = await getAllSites(sandbox);

                if (sites.length === 0) {
                    console.log(`[${realmName}] ⚠ No sites found.`);
                    return { realm: realmName, sites: [], success: false };
                }

                console.log(`[${realmName}] Fetching detailed data for ${sites.length} site(s)...`);

                const siteDetails = await Promise.all(
                    sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, sandbox))
                );

                const validSites = siteDetails.filter(Boolean).map((site) =>
                    transformSiteToCartridgeInfo(site, realmName)
                );

                console.log(`[${realmName}] ✓ Processed ${validSites.length} site(s)`);

                return {
                    realm: realmName,
                    sites: validSites,
                    success: true
                };
            } catch (error) {
                console.log(`[${realmName}] ✗ Error: ${error.message}`);
                return {
                    realm: realmName,
                    sites: [],
                    success: false,
                    error: error.message
                };
            }
        });

        const realmResults = await Promise.all(realmPromises);

        // Aggregate all sites across all realms
        const allSitesAcrossRealms = [];
        const realmSummary = [];

        for (const result of realmResults) {
            if (result.success && result.sites.length > 0) {
                allSitesAcrossRealms.push(...result.sites);
                realmSummary.push({
                    realm: result.realm,
                    siteCount: result.sites.length
                });
            }
        }

        if (allSitesAcrossRealms.length === 0) {
            console.log('\nNo sites found across any realm. Aborting.\n');
            return;
        }

        console.log(`\n✓ Aggregated ${allSitesAcrossRealms.length} site(s) across ${realmSummary.length} realm(s)\n`);

        // Perform ONE comparison across ALL realms
        console.log('Comparing discovered cartridges with cartridges used across ALL realms...\n');
        const comparisonResult = compareCartridges(cartridges, allSitesAcrossRealms);

        // Export consolidated results
        const consolidatedFilePath = await exportComparisonToFile(comparisonResult, 'ALL_REALMS');
        console.log(`✓ Consolidated comparison saved to: ${consolidatedFilePath}\n`);

        // Print summary
        logCartridgeValidationSummaryHeader();
        logRealmsProcessed(realmSummary);
        logCartridgeValidationStats(
            allSitesAcrossRealms.length,
            comparisonResult.total,
            comparisonResult.used.length,
            comparisonResult.unused.length
        );

        if (comparisonResult.unused.length > 0) {
            logCartridgeValidationWarning(comparisonResult.unused.length, consolidatedFilePath);
        }

        logCartridgeValidationSummaryFooter();
    });

program
    .command('validate-site-xml')
    .description('[WIP] Validate that site.xml files match live SFCC cartridge paths')
    .action(async () => {
        console.log('\n[WIP] Validating site.xml files against live SFCC...\n');

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

        const realmAnswers = await inquirer.prompt(realmPrompt());
        const sandbox = getSandboxConfig(realmAnswers.realm);

        // Check if realm has siteTemplatesPath configured
        const realmConfig = getRealmConfig(realmAnswers.realm);

        if (!realmConfig.siteTemplatesPath) {
            console.log(
                `\n✗ Error: Realm "${realmAnswers.realm}" does not have ` +
                '"siteTemplatesPath" configured in config.json\n'
            );
            console.log('Please add "siteTemplatesPath" to the realm configuration.');
            console.log('Example: "siteTemplatesPath": "sites/site_template_bcwr080"\n');
            return;
        }

        console.log(`Site Templates Path: ${realmConfig.siteTemplatesPath}\n`);

        // Find all site.xml files
        console.log('Searching for site.xml files...\n');
        const siteXmlFiles = await findSiteXmlFiles(targetPath, realmConfig.siteTemplatesPath);

        if (siteXmlFiles.length === 0) {
            console.log('No site.xml files found.\n');
            return;
        }

        console.log(`Found ${siteXmlFiles.length} site.xml file(s):\n`);
        siteXmlFiles.forEach(f => {
            console.log(`  → ${f.siteLocale}: ${f.relativePath}`);
        });
        console.log();

        // Fetch live sites from SFCC
        console.log('Fetching live site data from SFCC...');
        const sites = await getAllSites(sandbox);

        if (sites.length === 0) {
            console.log('No sites found on SFCC.\n');
            return;
        }

        console.log(`Fetching detailed cartridge paths for ${sites.length} site(s)...\n`);

        const siteDetails = await Promise.all(
            sites.map((s) => getSiteById(s.id || s.site_id || s.siteId, sandbox))
        );

        const liveSitesMap = {};
        siteDetails.filter(Boolean).forEach((site) => {
            const siteInfo = transformSiteToCartridgeInfo(site);
            liveSitesMap[siteInfo.id] = siteInfo.cartridges;
        });

        // Parse and compare each site.xml
        console.log('Parsing and comparing site.xml files...\n');
        const comparisons = [];

        for (const xmlFile of siteXmlFiles) {
            try {
                const xmlData = await parseSiteXml(xmlFile.filePath);
                console.log(`[${xmlData.siteId}] Parsed ${xmlFile.relativePath}`);

                if (!liveSitesMap[xmlData.siteId]) {
                    console.log(`  ⚠ Warning: Site "${xmlData.siteId}" not found on live SFCC`);
                    continue;
                }

                const comparison = compareSiteXmlWithLive(
                    xmlData.cartridges,
                    liveSitesMap[xmlData.siteId]
                );

                comparisons.push({
                    siteId: xmlData.siteId,
                    xmlFile: xmlFile.relativePath,
                    comparison
                });

                console.log(`  ${comparison.isMatch ? '✓ Match' : '✗ Mismatch'}`);
            } catch (error) {
                console.log(`  ✗ Error parsing ${xmlFile.relativePath}: ${error.message}`);
            }
        }

        if (comparisons.length === 0) {
            console.log('\nNo comparisons to export.\n');
            return;
        }

        // Export results
        const reportPath = await exportSiteXmlComparison(comparisons, realmAnswers.realm);
        console.log(`\n✓ Validation report saved to: ${reportPath}\n`);

        // Print summary
        const stats = calculateValidationStats(comparisons);
        logSiteXmlValidationSummary(stats);
    });

program.parse();
