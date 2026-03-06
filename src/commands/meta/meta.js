import inquirer from 'inquirer';
import path from 'path';
import { startTimer } from '../../helpers/timer.js';
import { getSiblingRepositories } from '../../io/util.js';
import {
    repositoryPrompt,
    resolveRealmScopeSelection,
    deletionLevelPrompt,
    deletionSourcePrompt
} from '../prompts/index.js';
import {
    buildMetaCleanupPlan,
    executeMetaCleanupPlan,
    formatCleanupPlan,
    formatExecutionResults,
    scanSitesForRemainingPreferences,
    formatSitesScanResults
} from './helpers/metaFileCleanup.js';
import {
    consolidateMetaFiles,
    formatConsolidationResults
} from './helpers/metaConsolidation.js';
import {
    buildRealmPreferenceMapFromFiles,
    buildCrossRealmPreferenceMap
} from '../preferences/helpers/preferenceRemoval.js';
import {
    getInstanceType,
    getAvailableRealms
} from '../../config/helpers/helpers.js';
import {
    getCurrentBranch,
    listBranches,
    hasUncommittedChanges,
    getStatusSummary,
    createAndCheckoutBranch,
    stageAllChanges,
    commitChanges,
    getStagedDiffStat,
    generateCleanupBranchName
} from './helpers/gitHelper.js';

// ============================================================================
// META COMMANDS
// ============================================================================

/**
 * Register meta file management commands with the CLI program.
 *
 * @param {import('commander').Command} program - Commander.js program instance
 */
export function registerMetaCommands(program) {
    program
        .command('test-meta-cleanup')
        .description('Test meta file cleanup — preview/execute removal of preference definitions from repo XML')
        .option('--dry-run', 'Preview changes without modifying files (default)', true)
        .option('--execute', 'Actually modify files (disables dry-run)')
        .action(async (options) => {
            const timer = startTimer();
            const dryRun = !options.execute;

            console.log(`\n${'═'.repeat(80)}`);
            console.log(' META FILE CLEANUP');
            console.log(`${'═'.repeat(80)}`);
            console.log(`  Mode: ${dryRun ? 'DRY-RUN (no files will be changed)' : '⚠  LIVE — files will be modified'}`);
            console.log('');

            // Step 1: Select sibling repository
            const siblings = await getSiblingRepositories();
            if (siblings.length === 0) {
                console.log('No sibling repositories found.');
                return;
            }

            const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
            const repoPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

            // Step 2: Select realms
            const { realmList, instanceTypeOverride } = await resolveRealmScopeSelection(
                (questions) => inquirer.prompt(questions)
            );

            if (!realmList || realmList.length === 0) {
                console.log('No realms selected.');
                return;
            }

            // Determine instance type from first realm if not overridden
            const instanceType = instanceTypeOverride || getInstanceType(realmList[0]);
            console.log(`\n  Realms: ${realmList.join(', ')}`);
            console.log(`  Instance type: ${instanceType}`);
            console.log(`  Repository: ${repoPath}\n`);

            // Step 3: Select deletion tier
            const tierAnswers = await inquirer.prompt(deletionLevelPrompt());
            const maxTier = tierAnswers.deletionLevel;

            // Step 4: Select deletion source (per-realm vs cross-realm)
            const { deletionSource } = await inquirer.prompt(deletionSourcePrompt());
            const useCrossRealm = deletionSource === 'cross-realm';

            console.log(
                `\n  Source: ${useCrossRealm ? 'Cross-realm intersection' : 'Per-realm files'}`
            );

            // Step 5: Load deletion files
            console.log(`  Loading deletion candidates up to tier ${maxTier}...`);
            const {
                realmPreferenceMap,
                blockedByBlacklist,
                skippedByWhitelist,
                missingRealms
            } = useCrossRealm
                ? buildCrossRealmPreferenceMap(realmList, instanceType, { maxTier })
                : buildRealmPreferenceMapFromFiles(realmList, instanceType, { maxTier });

            // Show summary of loaded preferences
            let totalPrefs = 0;
            for (const [realm, prefs] of realmPreferenceMap) {
                console.log(`    ${realm}: ${prefs.length} preference(s)`);
                totalPrefs += prefs.length;
            }

            if (blockedByBlacklist.length > 0) {
                console.log(`    Blocked by blacklist: ${blockedByBlacklist.length}`);
            }
            if (skippedByWhitelist.length > 0) {
                console.log(`    Skipped (not whitelisted): ${skippedByWhitelist.length}`);
            }
            if (missingRealms.length > 0) {
                console.log(`    Missing deletion files for: ${missingRealms.join(', ')}`);
            }

            if (totalPrefs === 0) {
                console.log('\n  No preferences to process. Run analyze-preferences first.');
                return;
            }

            const selectedPreferenceIds = [];
            for (const preferenceIds of realmPreferenceMap.values()) {
                selectedPreferenceIds.push(...preferenceIds);
            }

            // Step 6: Build cleanup plan
            console.log('\n  Building meta file cleanup plan...');
            const allConfiguredRealms = getAvailableRealms();
            const plan = buildMetaCleanupPlan(
                repoPath, realmPreferenceMap, allConfiguredRealms, { crossRealm: useCrossRealm }
            );

            // Step 7: Display the plan
            console.log(formatCleanupPlan(plan));

            if (plan.actions.length === 0) {
                console.log('  No meta file changes needed.');

                if (useCrossRealm) {
                    console.log('\n  Running cross-realm residual scan in sites/ ...');
                    const scanResults = scanSitesForRemainingPreferences({
                        repoPath,
                        preferenceIds: selectedPreferenceIds
                    });
                    console.log(formatSitesScanResults(scanResults));
                }

                const elapsed = timer.stop();
                console.log(`\n  Completed in ${elapsed}\n`);
                return;
            }

            // Step 8: Confirm and execute
            const confirmAnswers = await inquirer.prompt([{
                name: 'proceed',
                type: 'confirm',
                message: dryRun
                    ? `Execute dry-run for ${plan.actions.length} action(s)? (no files will be changed)`
                    : `⚠  Execute ${plan.actions.length} action(s)? This will modify files in the repository.`,
                default: dryRun
            }]);

            if (!confirmAnswers.proceed) {
                console.log('\n  Aborted.\n');
                return;
            }

            console.log('');
            const results = executeMetaCleanupPlan(plan, { dryRun });
            console.log(formatExecutionResults(results));

            if (useCrossRealm) {
                console.log('\n  Running cross-realm residual scan in sites/ ...');
                const scanResults = scanSitesForRemainingPreferences({
                    repoPath,
                    preferenceIds: selectedPreferenceIds
                });
                console.log(formatSitesScanResults(scanResults));
            }

            const elapsed = timer.stop();
            console.log(`  Completed in ${elapsed}\n`);
        });

    // ========================================================================
    // META CLEANUP — FULL GIT WORKFLOW
    // ========================================================================

    program
        .command('meta-cleanup')
        .description('Full meta cleanup workflow — create branch, remove preference definitions, stage & commit')
        .action(async () => {
            const timer = startTimer();

            console.log(`\n${'═'.repeat(80)}`);
            console.log(' META FILE CLEANUP — FULL WORKFLOW');
            console.log(`${'═'.repeat(80)}\n`);

            // ── Step 1: Select sibling repository ──────────────────────────
            const siblings = await getSiblingRepositories();
            if (siblings.length === 0) {
                console.log('No sibling repositories found.');
                return;
            }

            const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
            const repoPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

            // ── Step 2: Show repo status ───────────────────────────────────
            const currentBranch = getCurrentBranch(repoPath);
            console.log(`  Repository: ${repoPath}`);
            console.log(`  Current branch: ${currentBranch}`);

            if (hasUncommittedChanges(repoPath)) {
                console.log('\n  ⚠  Uncommitted changes detected:\n');
                console.log(getStatusSummary(repoPath)
                    .split('\n')
                    .map(l => `    ${l}`)
                    .join('\n'));

                const { proceed } = await inquirer.prompt([{
                    name: 'proceed',
                    type: 'confirm',
                    message: 'There are uncommitted changes. Continue anyway?',
                    default: false
                }]);

                if (!proceed) {
                    console.log('\n  Aborted — commit or stash changes first.\n');
                    return;
                }
            }

            // ── Step 3: Select base branch ─────────────────────────────────
            const branches = listBranches(repoPath);
            const { baseBranch } = await inquirer.prompt([{
                name: 'baseBranch',
                type: 'list',
                message: 'Select the base branch for the cleanup:',
                choices: branches,
                default: currentBranch
            }]);

            // ── Step 4: Select realms & tier ───────────────────────────────
            const { realmList, instanceTypeOverride } = await resolveRealmScopeSelection(
                (questions) => inquirer.prompt(questions)
            );

            if (!realmList || realmList.length === 0) {
                console.log('No realms selected.');
                return;
            }

            const instanceType = instanceTypeOverride || getInstanceType(realmList[0]);

            const tierAnswers = await inquirer.prompt(deletionLevelPrompt());
            const maxTier = tierAnswers.deletionLevel;

            const { deletionSource } = await inquirer.prompt(deletionSourcePrompt());
            const useCrossRealm = deletionSource === 'cross-realm';

            // ── Step 5: Generate branch name ───────────────────────────────
            const suggestedName = generateCleanupBranchName(
                `P${maxTier}-${instanceType}`
            );

            const { branchName } = await inquirer.prompt([{
                name: 'branchName',
                type: 'input',
                message: 'Branch name:',
                default: suggestedName,
                validate: (input) => {
                    if (!input || !input.trim()) {
                        return 'Branch name cannot be empty';
                    }
                    if (/\s/.test(input.trim())) {
                        return 'Branch name cannot contain spaces';
                    }
                    if (branches.includes(input.trim())) {
                        return 'Branch already exists';
                    }
                    return true;
                }
            }]);

            // ── Step 6: Create branch ──────────────────────────────────────
            console.log(`\n  Creating branch ${branchName} from ${baseBranch}...`);

            const branchCreated = createAndCheckoutBranch(repoPath, branchName.trim(), baseBranch);
            if (!branchCreated) {
                console.log('  ✗ Failed to create branch. Aborting.\n');
                return;
            }

            // ── Step 7: Load preferences & build plan ──────────────────────
            console.log(`\n  Loading deletion candidates up to tier ${maxTier}...`);
            console.log(`  Source: ${useCrossRealm ? 'Cross-realm intersection' : 'Per-realm files'}`);
            console.log(`  Realms: ${realmList.join(', ')}`);
            console.log(`  Instance type: ${instanceType}\n`);

            const {
                realmPreferenceMap,
                blockedByBlacklist,
                skippedByWhitelist,
                missingRealms
            } = useCrossRealm
                ? buildCrossRealmPreferenceMap(realmList, instanceType, { maxTier })
                : buildRealmPreferenceMapFromFiles(realmList, instanceType, { maxTier });

            let totalPrefs = 0;
            for (const [realm, prefs] of realmPreferenceMap) {
                console.log(`    ${realm}: ${prefs.length} preference(s)`);
                totalPrefs += prefs.length;
            }

            if (blockedByBlacklist.length > 0) {
                console.log(`    Blocked by blacklist: ${blockedByBlacklist.length}`);
            }
            if (skippedByWhitelist.length > 0) {
                console.log(`    Skipped (not whitelisted): ${skippedByWhitelist.length}`);
            }
            if (missingRealms.length > 0) {
                console.log(`    Missing deletion files for: ${missingRealms.join(', ')}`);
            }

            if (totalPrefs === 0) {
                console.log('\n  No preferences to process. Run analyze-preferences first.');
                console.log('  Branch was created but no changes were made.\n');
                return;
            }

            const selectedPreferenceIds = [];
            for (const preferenceIds of realmPreferenceMap.values()) {
                selectedPreferenceIds.push(...preferenceIds);
            }

            const allConfiguredRealms = getAvailableRealms();
            const plan = buildMetaCleanupPlan(
                repoPath, realmPreferenceMap, allConfiguredRealms, { crossRealm: useCrossRealm }
            );

            console.log(formatCleanupPlan(plan));

            if (plan.actions.length === 0) {
                console.log('  No meta file changes needed.');

                if (useCrossRealm) {
                    console.log('\n  Running cross-realm residual scan in sites/ ...');
                    const scanResults = scanSitesForRemainingPreferences({
                        repoPath,
                        preferenceIds: selectedPreferenceIds
                    });
                    console.log(formatSitesScanResults(scanResults));
                }

                console.log('  Branch was created but no changes were made.\n');
                return;
            }

            // ── Step 8: Confirm and execute ────────────────────────────────
            const { confirmExecute } = await inquirer.prompt([{
                name: 'confirmExecute',
                type: 'confirm',
                message: `Execute ${plan.actions.length} action(s)?`
                    + ` This will modify files in ${siblingAnswers.repository}.`,
                default: false
            }]);

            if (!confirmExecute) {
                console.log('\n  Aborted. Branch exists but no files were modified.\n');
                return;
            }

            console.log('');
            const results = executeMetaCleanupPlan(plan, { dryRun: false });
            console.log(formatExecutionResults(results));

            if (useCrossRealm) {
                console.log('\n  Running cross-realm residual scan in sites/ ...');
                const scanResults = scanSitesForRemainingPreferences({
                    repoPath,
                    preferenceIds: selectedPreferenceIds
                });
                console.log(formatSitesScanResults(scanResults));
            }

            // ── Step 8b: Meta file format ──────────────────────────────────
            const { metaFormat } = await inquirer.prompt([{
                name: 'metaFormat',
                type: 'list',
                message: 'How should meta files be structured going forward?',
                choices: [
                    {
                        name: 'Keep current multi-file setup',
                        value: 'multi'
                    },
                    {
                        name: 'Consolidate to single file per realm'
                            + ' (runs backup job to download fresh metadata)',
                        value: 'single'
                    }
                ],
                default: 'multi'
            }]);

            if (metaFormat === 'single') {
                console.log('\n  Consolidating meta files...\n');

                const consolidation = await consolidateMetaFiles({
                    repoPath, realmList, instanceType
                });
                console.log(formatConsolidationResults(consolidation));

                if (consolidation.failCount > 0 && consolidation.successCount === 0) {
                    console.log('  All consolidations failed — skipping.\n');
                } else if (consolidation.failCount > 0) {
                    const { continueAnyway } = await inquirer.prompt([{
                        name: 'continueAnyway',
                        type: 'confirm',
                        message: `${consolidation.failCount} realm(s) failed to consolidate.`
                            + ' Continue with commit?',
                        default: true
                    }]);

                    if (!continueAnyway) {
                        console.log('  Aborted.\n');
                        const elapsed = timer.stop();
                        console.log(`  Completed in ${elapsed}\n`);
                        return;
                    }
                }
            }

            // ── Step 9: Stage & commit ─────────────────────────────────────
            const totalChanged = results.filesModified.length
                + results.filesDeleted.length
                + results.filesCreated.length;

            if (totalChanged === 0) {
                console.log('  No files were changed — skipping commit.\n');
                const elapsed = timer.stop();
                console.log(`  Completed in ${elapsed}\n`);
                return;
            }

            const { confirmCommit } = await inquirer.prompt([{
                name: 'confirmCommit',
                type: 'confirm',
                message: `Stage and commit ${totalChanged} changed file(s)?`,
                default: true
            }]);

            if (!confirmCommit) {
                console.log('  Changes left unstaged. Commit manually when ready.\n');
                const elapsed = timer.stop();
                console.log(`  Completed in ${elapsed}\n`);
                return;
            }

            stageAllChanges(repoPath);

            const diffStat = getStagedDiffStat(repoPath);
            if (diffStat) {
                console.log(`\n  Staged changes:\n${diffStat.split('\n').map(l => `    ${l}`).join('\n')}\n`);
            }

            // Build list of removed attribute IDs (deduplicated, sorted)
            const removedIds = [...new Set(
                plan.actions
                    .filter(a => a.type === 'remove')
                    .map(a => a.attributeId)
            )].sort();

            const suggestedMsg = 'chore: remove '
                + `${removedIds.length} unused site preference definition(s)`
                + ` — P${maxTier} ${instanceType}`;

            const { commitMsg } = await inquirer.prompt([{
                name: 'commitMsg',
                type: 'input',
                message: 'Commit message:',
                default: suggestedMsg
            }]);

            // Build commit body with removed attribute list
            const commitBody = 'Removed attributes:\n'
                + removedIds.map(id => `- ${id}`).join('\n');

            const committed = commitChanges(
                repoPath, commitMsg.trim(), commitBody
            );
            if (committed) {
                console.log(`\n  Branch: ${branchName}`);
                console.log('  Ready to push and create a pull request.\n');
            }

            const elapsed = timer.stop();
            console.log(`  Completed in ${elapsed}\n`);
        });
}
