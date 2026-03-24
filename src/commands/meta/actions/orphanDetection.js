import inquirer from 'inquirer';
import { startTimer } from '../../../helpers/timer.js';
import { logSectionTitle, logRuntime } from '../../../scripts/loggingScript/log.js';
import { LOG_PREFIX } from '../../../config/constants.js';
import { getInstanceType } from '../../../config/helpers/helpers.js';
import { openFileInVSCode } from '../../../io/util.js';
import { resolveRealmScopeSelection } from '../../prompts/index.js';
import { promptForRepositoryPath } from './shared.js';
import {
    detectOrphansForRealm,
    formatOrphanReport,
    writeOrphanReport
} from '../helpers/orphanHelper.js';

// ============================================================================
// DETECT ORPHANS
// Compare BM metadata backup against repo meta XMLs to find orphan preferences
// ============================================================================

/**
 * Detect orphan preferences — preferences that exist on one side
 * (BM or repo XML) but not the other.
 */
export async function detectOrphans() {
    const timer = startTimer();

    console.log(`\n${'═'.repeat(80)}`);
    console.log(' ORPHAN PREFERENCE DETECTION');
    console.log(`${'═'.repeat(80)}`);
    console.log('  Compares BM metadata backup XML against repo meta XML files.');
    console.log('');

    // --- STEP 1: Select sibling repository ---
    logSectionTitle('STEP 1: Select Repository');

    const repoPath = await promptForRepositoryPath();
    if (!repoPath) {
        return;
    }

    // --- STEP 2: Select realms ---
    logSectionTitle('STEP 2: Select Realms');

    const { realmList, instanceTypeOverride } = await resolveRealmScopeSelection(
        (questions) => inquirer.prompt(questions)
    );

    if (!realmList || realmList.length === 0) {
        console.log(`${LOG_PREFIX.WARNING} No realms selected.`);
        return;
    }

    const instanceType = instanceTypeOverride || getInstanceType(realmList[0]);

    // --- STEP 3: Compare against BM backup per realm ---
    logSectionTitle('STEP 3: Comparing Against BM Backups');

    const results = [];

    for (const realm of realmList) {
        console.log(`  Processing ${realm}...`);
        const result = detectOrphansForRealm({ realm, repoPath });

        if (!result.metadataFile) {
            console.log(
                `  ${LOG_PREFIX.WARNING} No BM metadata backup found for ${realm}`
                + ' — run backup-site-preferences first'
            );
        } else {
            console.log(
                `  ${LOG_PREFIX.INFO} ${realm}: BM-only=${result.bmOnly.length}`
                + `, Repo-only=${result.repoOnly.length}`
            );
        }

        results.push(result);
    }

    // --- STEP 4: Write report ---
    logSectionTitle('STEP 4: Writing Report');

    const report = formatOrphanReport({ results, repoPath, instanceType });
    const outputPath = writeOrphanReport(report, instanceType);

    console.log(`\n${LOG_PREFIX.INFO} Report saved to: ${outputPath}`);

    try {
        await openFileInVSCode(outputPath);
    } catch {
        // VS Code may not be available
    }

    logRuntime(timer);
}
