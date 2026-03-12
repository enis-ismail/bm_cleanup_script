import inquirer from 'inquirer';
import path from 'path';
import { startTimer } from '../../helpers/timer.js';
import { getSiblingRepositories } from '../../io/util.js';
import {
    repositoryPrompt,
    resolveRealmScopeSelection,
    deletionLevelPrompt,
    deletionSourcePrompt,
    confirmExecutionPrompt,
    uncommittedChangesPrompt,
    branchStrategyPrompt,
    baseBranchPrompt,
    branchNamePrompt,
    consolidateMetaPrompt,
    consolidationFailurePrompt,
    confirmCommitPrompt,
    commitMessagePrompt
} from '../prompts/index.js';
import {
    buildMetaCleanupPlan,
    executeMetaCleanupPlan,
    formatCleanupPlan,
    formatExecutionResults,
    scanSitesForRemainingPreferences,
    formatSitesScanResults,
    removePreferenceValuesFromSites,
    formatPreferenceValueResults,
    stripCustomPrefix
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
    getRealmsByInstanceType
} from '../../config/helpers/helpers.js';
import { TIER_DESCRIPTIONS } from '../../config/constants.js';
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
// META COMMANDS REGISTRATION
// Register all meta file management commands with the CLI program
// ============================================================================

/**
 * Register meta file management commands with the CLI program.
 * @param {import('commander').Command} program - Commander.js program instance
 */
export function registerMetaCommands(program) {
    program
        .command('test-meta-cleanup')
        .description('Test meta file cleanup — preview/execute removal of preference definitions from repo XML')
        .option('--dry-run', 'Preview changes without modifying files (default)', true)
        .option('--execute', 'Actually modify files (disables dry-run)')
        .action(async (options) => testMetaCleanup(options));

    program
        .command('meta-cleanup')
        .description('Full meta cleanup workflow — create branch, remove preference definitions, stage & commit')
        .action(metaCleanup);
}

// ============================================================================
// TEST META CLEANUP
// Preview/execute removal of preference definitions from repository XML
// ============================================================================

/**
 * @param {Object} options - Command options
 * @param {boolean} [options.execute] - If true, modify files; otherwise dry-run
 */
async function testMetaCleanup(options) {
    const timer = startTimer();
    const dryRun = !options.execute;

    console.log(`\n${'═'.repeat(80)}`);
    console.log(' META FILE CLEANUP');
    console.log(`${'═'.repeat(80)}`);
    console.log(`  Mode: ${dryRun ? 'DRY-RUN (no files will be changed)' : '⚠  LIVE — files will be modified'}`);
    console.log('');

    // --- STEP 1: Select sibling repository ---
    const repoPath = await promptForRepositoryPath();
    if (!repoPath) {
        return;
    }

    // --- STEP 2: Select realms ---
    const { realmList, instanceTypeOverride } = await resolveRealmScopeSelection(
        (questions) => inquirer.prompt(questions)
    );

    if (!realmList || realmList.length === 0) {
        console.log('No realms selected.');
        return;
    }

    const instanceType = instanceTypeOverride || getInstanceType(realmList[0]);
    console.log(`\n  Realms: ${realmList.join(', ')}`);
    console.log(`  Instance type: ${instanceType}`);
    console.log(`  Repository: ${repoPath}\n`);

    // --- STEP 3: Select deletion tier ---
    const tierAnswers = await inquirer.prompt(deletionLevelPrompt());
    const maxTier = tierAnswers.deletionLevel;

    // --- STEP 4: Select deletion source (per-realm vs cross-realm) ---
    const { deletionSource } = await inquirer.prompt(deletionSourcePrompt());
    const useCrossRealm = deletionSource === 'cross-realm';

    console.log(
        `\n  Source: ${useCrossRealm ? 'Cross-realm intersection' : 'Per-realm files'}`
    );

    // --- STEP 5: Load deletion files ---
    const { realmPreferenceMap, selectedPreferenceIds, totalPrefs } = loadDeletionCandidates({
        realmList, instanceType, maxTier, useCrossRealm
    });

    if (totalPrefs === 0) {
        console.log('\n  No preferences to process. Run analyze-preferences first.');
        return;
    }

    // --- STEP 6: Build cleanup plan ---
    console.log('\n  Building meta file cleanup plan...');
    const allInstanceRealms = getRealmsByInstanceType(instanceType);
    const plan = buildMetaCleanupPlan(
        repoPath, realmPreferenceMap, allInstanceRealms, { crossRealm: useCrossRealm }
    );

    // --- STEP 7: Display the plan ---
    console.log(formatCleanupPlan(plan));

    if (plan.actions.length === 0) {
        console.log('  No meta file changes needed.');
        runCrossRealmScanIfNeeded({ useCrossRealm, repoPath, selectedPreferenceIds });
        const elapsed = timer.stop();
        console.log(`\n  Completed in ${elapsed}\n`);
        return;
    }

    // --- STEP 8: Confirm and execute ---
    const { confirm } = await inquirer.prompt(
        confirmExecutionPrompt({ actionCount: plan.actions.length, dryRun })
    );

    if (!confirm) {
        console.log('\n  Aborted.\n');
        return;
    }

    console.log('');
    const results = executeMetaCleanupPlan(plan, { dryRun });
    console.log(formatExecutionResults(results));

    // Remove orphaned preference values from preferences.xml files
    console.log('\n  Cleaning preference values from preferences.xml files...');
    const prefValueResults = removePreferenceValuesFromSites({
        repoPath,
        preferenceIds: selectedPreferenceIds,
        dryRun
    });
    console.log(formatPreferenceValueResults(prefValueResults));

    runCrossRealmScanIfNeeded({ useCrossRealm, repoPath, selectedPreferenceIds });

    const elapsed = timer.stop();
    console.log(`  Completed in ${elapsed}\n`);
}

// ============================================================================
// META CLEANUP
// Full git workflow — create branch, remove preference definitions, stage & commit
// ============================================================================

async function metaCleanup() {
    const timer = startTimer();

    console.log(`\n${'═'.repeat(80)}`);
    console.log(' META FILE CLEANUP — FULL WORKFLOW');
    console.log(`${'═'.repeat(80)}\n`);

    // --- STEP 1: Select sibling repository ---
    const siblings = await getSiblingRepositories();
    if (siblings.length === 0) {
        console.log('No sibling repositories found.');
        return;
    }

    const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
    const repoPath = path.join(path.dirname(process.cwd()), siblingAnswers.repository);

    // --- STEP 2: Show repo status ---
    const currentBranch = getCurrentBranch(repoPath);
    console.log(`  Repository: ${repoPath}`);
    console.log(`  Current branch: ${currentBranch}`);

    if (hasUncommittedChanges(repoPath)) {
        console.log('\n  ⚠  Uncommitted changes detected:\n');
        console.log(getStatusSummary(repoPath)
            .split('\n')
            .map(l => `    ${l}`)
            .join('\n'));

        const { proceed } = await inquirer.prompt(
            uncommittedChangesPrompt()
        );

        if (!proceed) {
            console.log('\n  Aborted — commit or stash changes first.\n');
            return;
        }
    }

    // --- STEP 3: Select realms ---
    const { realmList, instanceTypeOverride } = await resolveRealmScopeSelection(
        (questions) => inquirer.prompt(questions)
    );

    if (!realmList || realmList.length === 0) {
        console.log('No realms selected.');
        return;
    }

    const instanceType = instanceTypeOverride || getInstanceType(realmList[0]);

    // --- STEP 4: Select deletion tier & source ---
    const tierAnswers = await inquirer.prompt(deletionLevelPrompt());
    const maxTier = tierAnswers.deletionLevel;

    const { deletionSource } = await inquirer.prompt(deletionSourcePrompt());
    const useCrossRealm = deletionSource === 'cross-realm';

    // --- STEP 5: Load preferences & build plan ---
    console.log(`\n  Loading deletion candidates up to tier ${maxTier}...`);
    console.log(`  Source: ${useCrossRealm ? 'Cross-realm intersection' : 'Per-realm files'}`);
    console.log(`  Realms: ${realmList.join(', ')}`);
    console.log(`  Instance type: ${instanceType}\n`);

    const { realmPreferenceMap, selectedPreferenceIds, totalPrefs } = loadDeletionCandidates({
        realmList, instanceType, maxTier, useCrossRealm
    });

    if (totalPrefs === 0) {
        console.log('\n  No preferences to process. Run analyze-preferences first.\n');
        return;
    }

    const allInstanceRealms = getRealmsByInstanceType(instanceType);
    const plan = buildMetaCleanupPlan(
        repoPath, realmPreferenceMap, allInstanceRealms, { crossRealm: useCrossRealm }
    );

    console.log(formatCleanupPlan(plan));

    if (plan.actions.length === 0) {
        console.log('  No meta file changes needed.');
        runCrossRealmScanIfNeeded({ useCrossRealm, repoPath, selectedPreferenceIds });
        return;
    }

    // --- STEP 6: Branch strategy ---
    const { branchStrategy } = await inquirer.prompt(
        branchStrategyPrompt(currentBranch)
    );
    const useCurrentBranch = branchStrategy === 'current';

    let branchName = currentBranch;

    if (!useCurrentBranch) {
        const branches = listBranches(repoPath);
        const { baseBranch } = await inquirer.prompt(
            baseBranchPrompt(branches, currentBranch)
        );

        const suggestedName = generateCleanupBranchName(
            `${maxTier}-${instanceType}`
        );

        const { branchName: newBranchName } = await inquirer.prompt(
            branchNamePrompt(suggestedName, branches)
        );
        branchName = newBranchName;

        console.log(`\n  Creating branch ${branchName} from ${baseBranch}...`);

        const branchCreated = createAndCheckoutBranch(repoPath, branchName.trim(), baseBranch);
        if (!branchCreated) {
            console.log('  ✗ Failed to create branch. Aborting.\n');
            return;
        }
    } else {
        console.log(`\n  Applying changes to current branch: ${currentBranch}`);
    }

    // --- STEP 7: Confirm and execute ---
    const { confirm: confirmExecute } = await inquirer.prompt(
        confirmExecutionPrompt({
            actionCount: plan.actions.length,
            repoName: siblingAnswers.repository
        })
    );

    if (!confirmExecute) {
        console.log('\n  Aborted. No files were modified.\n');
        return;
    }

    console.log('');
    const results = executeMetaCleanupPlan(plan, { dryRun: false });
    console.log(formatExecutionResults(results));

    // --- STEP 8a: Remove orphaned preference values ---
    console.log('\n  Cleaning preference values from preferences.xml files...');
    const prefValueResults = removePreferenceValuesFromSites({
        repoPath,
        preferenceIds: selectedPreferenceIds
    });
    console.log(formatPreferenceValueResults(prefValueResults));

    if (prefValueResults.totalRemoved > 0) {
        results.filesModified.push(
            ...prefValueResults.filesModified
                .map(rel => path.join(repoPath, rel))
        );
    }

    runCrossRealmScanIfNeeded({ useCrossRealm, repoPath, selectedPreferenceIds });

    // --- STEP 8b: Meta file consolidation ---
    const { consolidate } = await inquirer.prompt(
        consolidateMetaPrompt()
    );

    if (consolidate) {
        console.log('\n  Consolidating meta files...\n');

        const consolidation = await consolidateMetaFiles({
            repoPath, realmList, instanceType
        });
        console.log(formatConsolidationResults(consolidation));

        if (consolidation.failCount > 0 && consolidation.successCount === 0) {
            console.log('  All consolidations failed — skipping.\n');
        } else if (consolidation.failCount > 0) {
            const { continueAnyway } = await inquirer.prompt(
                consolidationFailurePrompt(consolidation.failCount)
            );

            if (!continueAnyway) {
                console.log('  Aborted.\n');
                const elapsed = timer.stop();
                console.log(`  Completed in ${elapsed}\n`);
                return;
            }
        }
    }

    // --- STEP 9: Stage & commit ---
    const totalChanged = results.filesModified.length
        + results.filesDeleted.length
        + results.filesCreated.length;

    if (totalChanged === 0) {
        console.log('  No files were changed — skipping commit.\n');
        const elapsed = timer.stop();
        console.log(`  Completed in ${elapsed}\n`);
        return;
    }

    const { confirmCommit } = await inquirer.prompt(
        confirmCommitPrompt(totalChanged)
    );

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

    // Build list of selected attribute IDs from deletion source + P level
    const removedIds = [...new Set(
        selectedPreferenceIds.map(stripCustomPrefix)
    )].sort();

    const suggestedMsg = 'chore: remove '
        + `${removedIds.length} unused site preference definition(s)`
        + ` — ${maxTier} ${instanceType}`;

    const { commitMsg } = await inquirer.prompt(
        commitMessagePrompt(suggestedMsg)
    );

    // Build commit body with source context, selected level, and attribute list
    const tierDesc = TIER_DESCRIPTIONS[maxTier] || maxTier;
    const commitBody = [
        `Source: ${useCrossRealm ? 'cross-realm intersection' : 'per-realm deletion files'}`,
        `Level: ${maxTier} — ${tierDesc}`,
        '',
        'Removed attributes:',
        ...removedIds.map(id => `- ${id}`)
    ].join('\n');

    const committed = commitChanges(
        repoPath, commitMsg.trim(), commitBody
    );
    if (committed) {
        console.log(`\n  Branch: ${branchName}`);
        console.log('  Ready to push and create a pull request.\n');
    }

    const elapsed = timer.stop();
    console.log(`  Completed in ${elapsed}\n`);
}

// ============================================================================
// PRIVATE HELPER FUNCTIONS
// Small focused functions that support the command workflows above
// ============================================================================

/**
 * Prompt user to select a sibling repository and return the resolved path.
 * @returns {Promise<string|null>} Resolved repository path, or null if none found
 */
async function promptForRepositoryPath() {
    const siblings = await getSiblingRepositories();
    if (siblings.length === 0) {
        console.log('No sibling repositories found.');
        return null;
    }

    const siblingAnswers = await inquirer.prompt(await repositoryPrompt(siblings));
    return path.join(path.dirname(process.cwd()), siblingAnswers.repository);
}

/**
 * Load deletion candidates from per-realm or cross-realm files, log summary, and return
 * the preference map along with a flat list of selected IDs.
 * @param {Object} params
 * @param {string[]} params.realmList - Realms to load
 * @param {string} params.instanceType - Instance type
 * @param {string} params.maxTier - Maximum deletion tier
 * @param {boolean} params.useCrossRealm - Whether to use cross-realm intersection
 * @returns {{ realmPreferenceMap: Map, selectedPreferenceIds: string[], totalPrefs: number }}
 */
function loadDeletionCandidates({ realmList, instanceType, maxTier, useCrossRealm }) {
    console.log(`  Loading deletion candidates up to tier ${maxTier}...`);
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

    const selectedPreferenceIds = [];
    for (const preferenceIds of realmPreferenceMap.values()) {
        selectedPreferenceIds.push(...preferenceIds);
    }

    return { realmPreferenceMap, selectedPreferenceIds, totalPrefs };
}

/**
 * Run cross-realm residual scan if cross-realm mode is active.
 * @param {Object} params
 * @param {boolean} params.useCrossRealm - Whether cross-realm mode is active
 * @param {string} params.repoPath - Repository path
 * @param {string[]} params.selectedPreferenceIds - Preference IDs to scan for
 */
function runCrossRealmScanIfNeeded({ useCrossRealm, repoPath, selectedPreferenceIds }) {
    if (useCrossRealm) {
        console.log('\n  Running cross-realm residual scan in sites/ ...');
        const scanResults = scanSitesForRemainingPreferences({
            repoPath,
            preferenceIds: selectedPreferenceIds
        });
        console.log(formatSitesScanResults(scanResults));
    }
}
