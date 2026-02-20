import path from 'path';
import chalk from 'chalk';
import { LOG_PREFIX, SEPARATOR } from '../../config/constants.js';

/**
 * Logger utilities for console output
 */

/**
 * Log a message with optional newline
 * @param {string} message - Message to log
 * @param {boolean} newline - Whether to add a newline at the end
 */
export function log(message, newline = false) {
    console.log(message + (newline ? '\n' : ''));
}

/**
 * Log a section title with separator lines
 * @param {string} title - Title text to display
 */
export function logSectionTitle(title) {
    console.log(`\n${SEPARATOR}`);
    console.log(title);
    console.log(SEPARATOR);
}

/**
 * Log the start of the check-preferences process
 */
export function logCheckPreferencesStart() {
    log('Checking for unused preferences...', true);
}

/**
 * Log when no matrix files are found
 */
export function logNoMatrixFiles() {
    log('No matrix files found in the results folder.');
}

/**
 * Log the number of matrix files found
 * @param {number} count - Number of matrix files
 */
export function logMatrixFilesFound(count) {
    log(`Found ${count} matrix file(s).`, true);
}

/**
 * Log processing start for a realm
 * @param {string} realm - Realm name
 */
export function logProcessingRealm(realm) {
    log(`\n=== Processing Realm: ${realm} ===`);
}

/**
 * Log when CSV data is empty or cannot be parsed
 */
export function logEmptyCSV() {
    log('  (empty or could not parse)');
}

/**
 * Log the number of unused preferences found
 * @param {number} count - Number of unused preferences
 */
export function logUnusedPreferencesFound(count) {
    log(`  Found ${count} unused preference(s)`, true);
}

/**
 * Log the path where unused preferences are saved
 * @param {string} path - File path
 */
export function logUnusedPreferencesSaved(path) {
    log(`  Saved to: ${path}`);
}

/**
 * Log when no unused preferences are found
 */
export function logNoUnusedPreferences() {
    log('  No unused preferences found.');
}

/**
 * Log the start of getting preferences
 * @param {string} objectType - Object type being retrieved
 * @param {string} instanceType - Instance type (sandbox/production)
 * @param {string} realmName - Name of the realm
 */
export function logGettingPreferences(objectType, instanceType, realmName) {
    log(`\nGetting ${objectType} for ${instanceType} in realm '${realmName}'...`, true);
}

/**
 * Log when preferences are successfully saved
 * @param {string} filePath - Path where file was saved
 */
export function logPreferencesSaved(filePath) {
    log(`\nPreferences saved to: ${filePath}`);
}

/**
 * Log the completion of a process
 */
export function logComplete() {
    log('\nComplete!');
}

/**
 * Log an error message
 * @param {string} message - Error message
 */
export function logError(message) {
    console.error(`${chalk.red('✖ ERROR:')} ${message}`);
}

/**
 * Log realm processing results
 * @param {number} total - Total number of preferences
 * @param {number} unused - Number of unused preferences
 * @param {string} outputFile - Path to output file
 */
export function logRealmResults(total, unused, outputFile) {
    const filename = path.basename(outputFile);
    log(`  Unused: ${unused} of ${total} (saved to ${filename})`);
}

/**
 * Log the summary header
 */
export function logSummaryHeader() {
    log(`\n${SEPARATOR}`);
    log('SUMMARY');
    log(SEPARATOR);
}

/**
 * Log summary for a single realm
 * @param {Object} stats - Statistics object
 * @param {string} stats.realm - Realm name
 * @param {number} stats.total - Total preferences
 * @param {number} stats.used - Used preferences
 * @param {number} stats.unused - Unused preferences
 */
export function logRealmSummary({ realm, total, used, unused }) {
    const usageRate = total > 0 ? ((used / total) * 100).toFixed(2) : 0;

    log(`\nRealm: ${realm}`);
    log(`  Total Preferences: ${total}`);
    log(`  Used Preferences: ${used}`);
    log(`  Unused Preferences: ${unused}`);
    log(`  Usage Rate: ${usageRate}%`);
}

/**
 * Log the summary footer
 */
export function logSummaryFooter() {
    log(`\n${SEPARATOR}`);
}

/**
 * Log cartridge validation summary header
 */
export function logCartridgeValidationSummaryHeader() {
    log(SEPARATOR);
    log('=== CARTRIDGE VALIDATION SUMMARY (ALL REALMS) ===');
    log(`${SEPARATOR}\n`);
}

/**
 * Log realms processed in cartridge validation
 * @param {Array} realmSummary - Array of realm summary objects
 */
export function logRealmsProcessed(realmSummary) {
    log('Realms Processed:');
    for (const summary of realmSummary) {
        log(`  • ${summary.realm}: ${summary.siteCount} site(s)`);
    }
}

/**
 * Log cartridge validation statistics from comparison results
 * @param {Object} result - Result object from validation containing realmSummary, comparisonResult, etc.
 */
export function logCartridgeValidationStats(result) {
    const totalSites = result.realmSummary.reduce((sum, r) => sum + r.siteCount, 0);
    const totalCartridges = result.comparisonResult.total;
    const usedCount = result.comparisonResult.used.length;
    const unusedCount = result.comparisonResult.unused.length;

    log(`\nTotal Sites: ${totalSites}`);
    log(`Total Discovered Cartridges: ${totalCartridges}`);
    log(`Cartridges Used Across All Realms: ${usedCount}`);
    log(`Cartridges UNUSED in ANY Realm: ${unusedCount}`);
}

/**
 * Log cartridge validation warning
 * @param {number} unusedCount - Number of unused cartridges
 * @param {string} filePath - Path to the report file
 */
export function logCartridgeValidationWarning(unusedCount, filePath) {
    log(`\n${LOG_PREFIX.WARNING} Warning: ${unusedCount} cartridge(s) in repo have NO usage across any realm.`);
    log(`See: ${filePath}`);
}

/**
 * Log cartridge validation summary footer
 */
export function logCartridgeValidationSummaryFooter() {
    log(`\n${SEPARATOR}\n`);
}

/**
 * Log site XML validation summary
 * @param {Object} stats - Statistics object
 * @param {number} stats.total - Total sites validated
 * @param {number} stats.matching - Number of matching sites
 * @param {number} stats.mismatched - Number of mismatched sites
 */
export function logSiteXmlValidationSummary(stats) {
    log(SEPARATOR);
    log('SUMMARY');
    log(SEPARATOR);
    log(`Total Sites Validated: ${stats.total}`);
    log(`Matching: ${stats.matching}`);
    log(`Mismatched: ${stats.mismatched}\n`);
}

/**
 * Log formatted cartridge list
 * @param {Array<string>} cartridges - Array of cartridge names
 */
export function logCartridgeList(cartridges) {
    log(`Found ${cartridges.length} unique cartridge(s):\n`);
    for (const cartridge of cartridges) {
        log(`  → ${cartridge}`);
    }
    log('');
}

// ============================================================================
// DYNAMIC STATUS LOGGING
// Plain status logging (no dynamic spinner)
// ============================================================================


let lastStatusMessage = '';

/**
 * Log a status line
 * @param {string} message - Status message to display
 * @param {boolean} animate - Unused; kept for backward compatibility
 */
export function logStatusUpdate(message, animate = true) {
    void animate;

    if (!message || message === lastStatusMessage) {
        return;
    }

    lastStatusMessage = message;
    console.log(`${chalk.blue('►')} ${chalk.blue(message)}`);
}

/**
 * Log a rate limit warning without interrupting current status
 * Displays orange warning below current status and restarts spinner
 * @param {string} message - Rate limit warning message
 */
export function logRateLimitWarning(message) {
    console.warn(`${chalk.yellow('⚠ RATE LIMITED:')} ${message}`);
}

/**
 * Log a dynamic rate limit countdown that updates in place
 * Shows "Retrying in Xs..." with countdown timer
 * @param {number} delayMs - Delay in milliseconds
 * @param {number} attempt - Current attempt number
 * @param {string} context - Optional context (e.g., attribute ID)
 */
export function logRateLimitCountdown(delayMs, attempt, context = '') {
    const contextStr = context ? ` on ${context}` : '';
    const seconds = Math.ceil(delayMs / 1000);
    console.warn(chalk.yellow(`⚠ RATE LIMITED${contextStr}: Retry ${attempt}/3 in ${seconds}s...`));
}

/**
 * Log completion/success message in green
 * @param {string} message - Completion message
 */
export function logCompletion(message) {
    lastStatusMessage = '';

    console.log(`${chalk.green('✓')} ${chalk.green(message)}`);
}

/**
 * Clear the current status line and start a fresh one
 * Stops the spinner without marking as success or failure
 */
export function logStatusClear() {
    lastStatusMessage = '';
}

/**
 * Log progress during file scanning operations
 * @param {Object} state - Progress state object
 * @param {number} state.scannedFiles - Number of files scanned so far
 * @param {number} state.totalFiles - Total number of files to scan
 * @param {number} state.logEvery - Log interval (every N files)
 * @param {number} state.matchesFound - Number of matches found
 * @param {boolean} isFirstSearch - Whether this is the first search (controls whether to log)
 */
export function logProgress(state, isFirstSearch) {
    if (!isFirstSearch) {
        return;
    }

    if (state.scannedFiles % state.logEvery === 0 || state.scannedFiles === state.totalFiles) {
        const remaining = Math.max(state.totalFiles - state.scannedFiles, 0);
        const percent = state.totalFiles > 0
            ? Math.min((state.scannedFiles / state.totalFiles) * 100, 100)
            : 100;

        logStatusUpdate(
            `Scanned ${state.scannedFiles}/${state.totalFiles} files (${percent.toFixed(1)}%), ` +
            `remaining: ${remaining}, matches: ${state.matchesFound}`
        );
    }
}

// ============================================================================
// SUMMARY LOGGING
// High-level summary output for command workflows
// ============================================================================

/**
 * Log total runtime at the end of a command
 * @param {Object} timer - Timer object with a stop() method
 */
export function logRuntime(timer) {
    console.log(`${LOG_PREFIX.INFO} Total runtime: ${timer.stop()}`);
}

/**
 * Log deletion summary after preference removal
 * @param {Object} stats - Deletion statistics
 * @param {number} stats.deleted - Number of preferences successfully deleted
 * @param {number} stats.failed - Number of failed deletions
 * @param {number} stats.realms - Number of realms processed
 */
export function logDeletionSummary({ deleted, failed, realms }) {
    logSectionTitle('DELETION SUMMARY');
    console.log(`${LOG_PREFIX.INFO} Total preferences deleted: ${deleted}`);
    if (failed > 0) {
        console.log(`${LOG_PREFIX.ERROR} Total preferences failed: ${failed}`);
    }
    console.log(`  Realms processed: ${realms}\n`);

    if (deleted > 0) {
        console.log(`${LOG_PREFIX.INFO} Preferences successfully removed from SFCC.`);
        console.log('   Backup files are available for restore if needed.\n');
    } else if (failed > 0) {
        console.log(`${LOG_PREFIX.WARNING} No preferences were deleted.`);
        console.log('   Check error messages above for details.\n');
    }
}

/**
 * Log restore summary after preference restoration
 * @param {Object} stats - Restore statistics
 * @param {number} stats.restored - Number of preferences restored
 * @param {number} stats.failed - Number of failed restorations
 * @param {string|number} stats.realm - Realm name or count of realms processed
 */
export function logRestoreSummary({ restored, failed, realm }) {
    logSectionTitle('RESTORE SUMMARY');
    console.log(`${LOG_PREFIX.INFO} Total preferences restored: ${restored}`);
    if (failed > 0) {
        console.log(`${LOG_PREFIX.ERROR} Total restoration failures: ${failed}`);
    }
    const realmLabel = typeof realm === 'number' ? `Realms processed: ${realm}` : `Realm: ${realm}`;
    console.log(`  ${realmLabel}\n`);

    if (restored > 0) {
        console.log(`${LOG_PREFIX.INFO} Preferences successfully restored from backup.\n`);
    } else if (failed > 0) {
        console.log(`${LOG_PREFIX.WARNING} Restoration encountered errors. Check messages above.\n`);
    }
}

/**
 * Log backup status for realms (existing vs. needing backup)
 * @param {string[]} withBackups - Realms with existing backups
 * @param {string[]} withoutBackups - Realms needing new backups
 */
export function logBackupClassification(withBackups, withoutBackups) {
    if (withBackups.length > 0) {
        logSectionTitle('EXISTING BACKUP FILES FOUND');
        withBackups.forEach(realm => {
            console.log(`  ${LOG_PREFIX.INFO} ${realm}: Backup exists for today's date`);
        });
        console.log('');
    }

    if (withoutBackups.length > 0) {
        console.log('Realms needing backup:');
        withoutBackups.forEach(realm => {
            console.log(`  - ${realm}: No backup found, will create`);
        });
        console.log('');
    }
}
