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
