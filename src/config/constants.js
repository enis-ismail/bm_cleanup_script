/**
 * API and Processing Constants
 * Configurable values for different instance types and processing tasks
 */

/**
 * Log message prefixes for consistent console output
 */
export const LOG_PREFIX = {
    INFO: '✓',
    WARNING: '⚠',
    ERROR: '✗'
};

/**
 * Standard separator line for formatting output (80 characters)
 */
export const SEPARATOR = '='.repeat(80);

/**
 * API request configuration by instance type
 * Adjust these values based on sandbox capacity and rate limits
 */
export const API_CONFIG = {
    sandbox: {
        batchSize: 25,           // Number of items to process in parallel
        batchDelayMs: 1000,        // Delay (ms) between batch requests
        retryAttempts: 3,         // Number of retry attempts for rate-limited requests
        requestTimeoutMs: 30000   // Timeout for individual API requests
    },
    development: {
        batchSize: 25,
        batchDelayMs: 1000,
        retryAttempts: 3,
        requestTimeoutMs: 30000
    },
    staging: {
        batchSize: 25,           // Staging can handle more parallel requests
        batchDelayMs: 1000,
        retryAttempts: 3,
        requestTimeoutMs: 30000
    },
    production: {
        batchSize: 50,            // Production is more conservative
        batchDelayMs: 300,        // Longer delay to avoid rate limiting
        retryAttempts: 5,         // More retries for production stability
        requestTimeoutMs: 45000
    }
};

/**
 * File scanning configuration
 * Used for preference usage search and code scanning
 */
export const SCAN_CONFIG = {
    logProgressEvery: 200,        // Log progress after scanning N files
    maxConcurrentReads: 10        // Maximum concurrent file read operations
};

/**
 * Directory names used throughout the application
 */
export const DIRECTORIES = {
    BACKUP: 'backup',
    BACKUP_DOWNLOADS: 'backup_downloads',
    RESULTS: 'results',
    CARTRIDGES: 'cartridges'
};

/**
 * Special identifiers and default values
 */
export const IDENTIFIERS = {
    ALL_REALMS: 'ALL_REALMS',
    SITE_PREFERENCES: 'SitePreferences',
    CUSTOM_ATTRIBUTE_PREFIX: 'c_'
};

/**
 * Realm tag values used in deletion candidate files and parsing logic
 */
export const REALM_TAGS = {
    ALL: 'ALL'
};

/**
 * File naming patterns and suffixes
 */
export const FILE_PATTERNS = {
    PREFERENCES_MATRIX: '_preferences_matrix.csv',
    PREFERENCES_USAGE: '_preferences_usage.csv',
    UNUSED_PREFERENCES: '_unused_preferences.txt',
    PREFERENCES_FOR_DELETION: '_preferences_for_deletion.txt',
    CARTRIDGE_PREFERENCES: '_cartridge_preferences.txt',
    PREFERENCE_USAGE: '_preference_usage.txt',
    USED_PREFERENCES: '_used_preferences.txt',
    CARTRIDGE_COMPARISON: '_cartridge_comparison.txt',
    SITE_CARTRIDGES_LIST: '_active_site_cartridges_list.csv',
    SITE_PREFERENCES_CSV: '_site_preferences.csv',
    SITE_XML_VALIDATION: '_site_xml_validation.txt',
    BACKUP_SUFFIX: '_backup_'
};

/**
 * Allowed file extensions for code scanning
 */
export const ALLOWED_EXTENSIONS = new Set([
    '.js',
    '.isml',
    '.ds',
    '.json',
    '.xml',
    '.properties',
    '.txt',
    '.html'
]);

/**
 * Directories to skip during code scanning
 */
export const SKIP_DIRECTORIES = new Set([
    'node_modules',
    'sites',
    'results',
    '.git',
    '.vscode'
]);

/**
 * Backup configuration
 */
export const BACKUP_CONFIG = {
    MAX_AGE_DAYS: 14,                    // Maximum age for reusing cached backups
    MS_PER_DAY: 1000 * 60 * 60 * 24     // Milliseconds in one day
};

/**
 * Default comparison file path for deprecated cartridges
 */
export const DEFAULT_COMPARISON_FILE = 'ALL_REALMS_cartridge_comparison.txt';

/**
 * Get API configuration for a specific instance type
 * Falls back to sandbox defaults if instance type not found
 * @param {string} instanceType - The instance type (sandbox, development, staging, production)
 * @returns {Object} API configuration for the instance type
 */
export function getApiConfig(instanceType) {
    return API_CONFIG[instanceType] || API_CONFIG.sandbox;
}

/**
 * Get configuration value with fallback
 * @param {string} instanceType - The instance type
 * @param {string} configKey - The configuration key (e.g., 'batchSize')
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Configuration value
 */
export function getConfigValue(instanceType, configKey, defaultValue) {
    const config = getApiConfig(instanceType);
    return config[configKey] !== undefined ? config[configKey] : defaultValue;
}
