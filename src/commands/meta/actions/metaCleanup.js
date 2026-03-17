import inquirer from 'inquirer';
import path from 'path';
import { startTimer } from '../../../helpers/timer.js';
import { getSiblingRepositories } from '../../../io/util.js';
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
} from '../../prompts/index.js';
import {
    buildMetaCleanupPlan,
    executeMetaCleanupPlan,
    formatCleanupPlan,
    formatExecutionResults,
    removePreferenceValuesFromSites,
    formatPreferenceValueResults,
    stripCustomPrefix
} from '../helpers/metaFileCleanup.js';
import {
    consolidateMetaFiles,
    formatConsolidationResults
} from '../helpers/metaConsolidation.js';
import { getInstanceType, getRealmsByInstanceType } from '../../../config/helpers/helpers.js';
import { TIER_DESCRIPTIONS } from '../../../config/constants.js';
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
} from '../helpers/gitHelper.js';
import { loadDeletionCandidates, runCrossRealmScanIfNeeded } from './shared.js';

// ============================================================================
// META CLEANUP
// Full git workflow — create branch, remove preference definitions, stage & commit
// ============================================================================

export async function metaCleanup() {
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
