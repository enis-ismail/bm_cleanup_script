import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { LOG_PREFIX, SEPARATOR } from './constants.js';

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
// For updating status in place without scrolling using ora spinner
// ============================================================================

/* global setInterval, clearInterval, setTimeout */

let currentSpinner = null;
let currentMessage = '';

/**
 * Log a status line that can be updated dynamically with animation
 * Uses ora spinner library with blue text for status updates
 * @param {string} message - Status message to display
 * @param {boolean} animate - Whether to show spinner animation (default true)
 */
export function logStatusUpdate(message, animate = true) {
    currentMessage = message;

    // Stop existing spinner if any
    if (currentSpinner) {
        currentSpinner.stop();
    }

    // Create new spinner with blue colored message
    currentSpinner = ora({
        text: chalk.blue(message),
        prefixText: chalk.blue('►')
    }).start();

    // Disable animation if requested
    if (!animate) {
        currentSpinner.stop();
    }
}

/**
 * Log a rate limit warning without interrupting current status
 * Displays orange warning below current status and restarts spinner
 * @param {string} message - Rate limit warning message
 */
export function logRateLimitWarning(message) {
    // Temporarily stop spinner to display warning
    const wasRunning = currentSpinner !== null;
    if (currentSpinner) {
        currentSpinner.stop();
    }

    // Log the warning in orange/yellow
    console.warn(`${chalk.yellow('⚠ RATE LIMITED:')} ${message}`);

    // Restart spinner if it was running
    if (wasRunning && currentMessage) {
        currentSpinner = ora({
            text: chalk.blue(currentMessage),
            prefixText: chalk.blue('►')
        }).start();
    }
}

/**
 * Log a dynamic rate limit countdown that updates in place
 * Shows "Retrying in Xs..." with countdown timer
 * @param {number} delayMs - Delay in milliseconds
 * @param {number} attempt - Current attempt number
 * @param {string} context - Optional context (e.g., attribute ID)
 */
export async function logRateLimitCountdown(delayMs, attempt, context = '') {
    const wasRunning = currentSpinner !== null;
    const previousMessage = currentMessage;

    // Stop spinner without destroying it
    if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
    }

    const totalSeconds = Math.ceil(delayMs / 1000);
    let remainingSeconds = totalSeconds;

    // Display initial countdown message
    const contextStr = context ? ` on ${context}` : '';
    process.stdout.write(
        `\r${chalk.yellow(`⚠ RATE LIMITED${contextStr}: Retry ${attempt}/3 in ${remainingSeconds}s...`)}`
    );

    // Wait for first second to elapse before starting interval
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Continue countdown
    return new Promise(resolve => {
        const countdownInterval = setInterval(() => {
            remainingSeconds -= 1;

            if (remainingSeconds > 0) {
                process.stdout.write(
                    `\r${chalk.yellow(`⚠ RATE LIMITED${contextStr}: Retry ${attempt}/3 in ${remainingSeconds}s...`)}`
                );
            } else {
                clearInterval(countdownInterval);
                process.stdout.write('\r\x1b[K'); // Clear line

                // Restart spinner if it was running
                if (wasRunning && previousMessage) {
                    currentMessage = previousMessage;
                    currentSpinner = ora({
                        text: chalk.blue(previousMessage),
                        prefixText: chalk.blue('►')
                    }).start();
                }

                resolve();
            }
        }, 1000);
    });
}

/**
 * Log completion/success message in green
 * @param {string} message - Completion message
 */
export function logCompletion(message) {
    // Stop any running spinner
    if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
    }
    currentMessage = '';

    console.log(`${chalk.green('✓')} ${chalk.green(message)}`);
}

/**
 * Clear the current status line and start a fresh one
 * Stops the spinner without marking as success or failure
 */
export function logStatusClear() {
    if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
    }
    currentMessage = '';
}
