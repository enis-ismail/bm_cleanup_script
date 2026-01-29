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
 * Log the start of the check-preferences process
 */
export function logCheckPreferencesStart() {
    log('Finding matrix files in results folder...', true);
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
    log(`Found ${count} matrix file(s)`, true);
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
    console.error(`ERROR: ${message}`);
}

/**
 * Log realm processing results
 * @param {number} total - Total number of preferences
 * @param {number} unused - Number of unused preferences
 * @param {string} outputFile - Path to output file
 */
export function logRealmResults(total, unused, outputFile) {
    log(`  Total preferences: ${total}`);
    log(`  Unused preferences: ${unused}`);
    log(`  Output file: ${outputFile}`);
}

/**
 * Log the summary header
 */
export function logSummaryHeader() {
    log('\n' + '='.repeat(60));
    log('SUMMARY');
    log('='.repeat(60));
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
    log('\n' + '='.repeat(60));
}
