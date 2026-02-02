import inquirer from 'inquirer';
import { Command } from 'commander';
import path from 'path';
import {
    addRealmToConfig,
    removeRealmFromConfig,
    findAllMatrixFiles,
    getSandboxConfig,
    getAvailableRealms,
    getInstanceType
} from './helpers.js';
import { startTimer } from './helpers/timer.js';
import { getSiblingRepositories } from './helpers/util.js';
import { exportAttributesToCSV } from './helpers/csv.js';
import { executeListSites, executeValidateCartridges, executeValidateCartridgesAll, executeValidateSiteXml } from './helpers/cartridgeCommands.js';
import {
    getSitePreferences
} from './api.js';
import {
    realmPrompt,
    objectTypePrompt,
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
        await executeListSites(realmAnswers.realm);
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
        await exportAttributesToCSV(allAttributes, sandbox.name);
    });

program
    .command('add-realm')
    .description('Add a new realm to config.json')
    .action(async () => {
        const answers = await inquirer.prompt(addRealmPrompts());
        addRealmToConfig(
            answers.name,
            answers.hostname,
            answers.clientId,
            answers.clientSecret,
            answers.siteTemplatesPath,
            answers.instanceType
        );
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
            ...scopePrompts(),
            ...includeDefaultsPrompt()
        ]);

        await executePreferenceSummarization({
            realm: realmAnswers.realm,
            objectType: answers.objectType,
            instanceType: getInstanceType(realmAnswers.realm),
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

        const realmAnswers = await inquirer.prompt(realmPrompt());
        await executeValidateCartridges(targetPath, realmAnswers.realm);
    });

program
    .command('validate-cartridges-all')
    .description('[WIP] Validate cartridges across ALL configured realms (parallel)')
    .action(async () => {
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

        const result = await executeValidateCartridgesAll(targetPath);

        if (!result) {
            return;
        }

        // Print summary
        logCartridgeValidationSummaryHeader();
        logRealmsProcessed(result.realmSummary);
        logCartridgeValidationStats(result);

        if (result.comparisonResult.unused.length > 0) {
            logCartridgeValidationWarning(result.comparisonResult.unused.length, result.consolidatedFilePath);
        }

        logCartridgeValidationSummaryFooter();
    });

program
    .command('validate-site-xml')
    .description('[WIP] Validate that site.xml files match live SFCC cartridge paths')
    .action(async () => {
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

        const realmAnswers = await inquirer.prompt(realmPrompt());
        const result = await executeValidateSiteXml(targetPath, realmAnswers.realm);

        if (!result) {
            return;
        }

        // Print summary
        logSiteXmlValidationSummary(result.stats);
    });

program.parse();
