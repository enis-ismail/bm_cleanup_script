import axios from 'axios';
import { processBatch, withLoadShedding } from './helpers/batch.js';
import { getSandboxConfig } from './helpers.js';
import { getApiConfig } from './helpers/constants.js';
import { logError } from './helpers/log.js';

/* eslint-disable no-undef */

// ============================================================================
// API REQUEST HELPERS
// Common patterns for OCAPI requests
// ============================================================================

/**
 * Build standard authorization headers for OCAPI requests
 * @param {string} token - OAuth bearer token
 * @returns {Object} Headers object with authorization
 * @private
 */
function buildApiHeaders(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Fetch data from an API endpoint with pagination support
 * @param {string} baseUrl - Base URL for pagination requests
 * @param {string} token - OAuth bearer token
 * @param {number} batchSize - Items per page (default 200)
 * @returns {Promise<Array>} All fetched items
 * @private
 */
async function paginatedApiFetch(baseUrl, token, batchSize = 200) {
    const allItems = [];
    const headers = buildApiHeaders(token);
    let start = 0;
    let total = 0;

    do {
        const url = `${baseUrl}?start=${start}&count=${batchSize}`;
        const response = await axios.get(url, { headers });

        const items = response.data.data || [];
        total = response.data.total || items.length;

        allItems.push(...items);
        start += items.length;

        console.log(`Fetched ${allItems.length} of ${total}...`);

        if (items.length === 0 || allItems.length >= total) {
            break;
        }
    } while (allItems.length < total);

    return allItems;
}

// ============================================================================
// OAUTH AUTHENTICATION
// Handle OAuth token generation for OCAPI access
// ============================================================================

/**
 * Obtain OAuth 2.0 access token for OCAPI requests
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<string>} OAuth bearer token
 */
export async function getOAuthToken(sandbox) {
    const tokenUrl = 'https://account.demandware.com/dwsso/oauth2/access_token';
    const credentials = Buffer.from(`${sandbox.clientId}:${sandbox.clientSecret}`).toString('base64');

    return withLoadShedding(
        async () => {
            const response = await axios.post(
                tokenUrl,
                new URLSearchParams({
                    grant_type: 'client_credentials'
                }).toString(),
                {
                    headers: {
                        'Authorization': `Basic ${credentials}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            return response.data.access_token;
        },
        {
            maxRetries: 3,
            onRetry: (attempt, delay) => {
                console.log(`Rate limited. Retry ${attempt}/3 in ${delay / 1000}s...`);
            }
        }
    );
}

// ============================================================================
// SITE MANAGEMENT
// Retrieve and manage SFCC site configurations
// ============================================================================

/**
 * Fetch all sites configured in the SFCC instance
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Array>} Array of site objects
 */
export async function getAllSites(realm) {
    try {
        const sandbox = getSandboxConfig(realm);
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v19_5/sites`;
        const headers = buildApiHeaders(token);
        const response = await axios.get(url, { headers });
        const sites = response.data.data || [];
        console.log(`Found ${sites.length} sites`);
        return sites;
    } catch (error) {
        logError(`Failed to fetch sites: ${error.response?.data?.message || error.message}`);
        return [];
    }
}

/**
 * Retrieve detailed configuration for a specific site
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} siteId - Site identifier
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Site object with full configuration
 */
export async function getSiteById(siteId, realm) {
    try {
        const sandbox = getSandboxConfig(realm);
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v19_5/sites/${encodeURIComponent(siteId)}`;
        const headers = buildApiHeaders(token);
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        logError(`Failed to fetch site ${siteId}: ${error.response?.data?.message || error.message}`);
        return null;
    }
}

// ============================================================================
// PREFERENCE ATTRIBUTES
// Retrieve system object attribute definitions
// ============================================================================

/**
 * Fetch all attribute definitions for a system object type with pagination
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {Object} sandbox - Sandbox configuration object
 * @param {boolean} includeDefaults - If true, fetch each attribute individually to get default_value
 * @returns {Promise<Array>} Array of attribute definition objects
 */
export async function getSitePreferences(objectType, realm, includeDefaults = false) {
    try {
        const sandbox = getSandboxConfig(realm);
        const startTime = Date.now();
        const token = await getOAuthToken(sandbox);
        const baseUrl = `https://${sandbox.hostname}/s/-/dw/data/v19_5/system_object_definitions/${objectType}/attribute_definitions`;
        const allAttributes = await paginatedApiFetch(baseUrl, token, 200);

        const listTime = Date.now() - startTime;
        const duration = (listTime / 1000).toFixed(2);
        console.log(`Found ${allAttributes.length} total attributes for ${objectType} (${duration}s)`);

        if (!includeDefaults) {
            return allAttributes;
        }

        console.log('\nFetching full details with default values (parallel batches)...');
        const detailStartTime = Date.now();
        const apiConfig = getApiConfig(sandbox.instanceType);

        const detailedAttributes = await processBatch(
            allAttributes,
            (attr) => getAttributeDefinitionById(objectType, attr.id, realm),
            apiConfig.batchSize,
            (progress, total, rate) => {
                const rateStr = rate.toFixed(1);
                console.log(`Fetched detailed info for ${progress} of ${total} attributes (${rateStr} attrs/sec)...`);
            },
            apiConfig.batchDelayMs
        );

        const detailTime = Date.now() - detailStartTime;
        const detailDuration = (detailTime / 1000).toFixed(2);
        const count = detailedAttributes.length;
        console.log(`Completed fetching ${count} attributes with full details (${detailDuration}s)`);
        return detailedAttributes;
    } catch (error) {
        logError(`Failed to fetch site preferences: ${error.response?.data?.message || error.message}`);
        return [];
    }
}

/**
 * Fetch a single attribute definition by ID
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {string} attributeId - Attribute ID to retrieve
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Single attribute definition object with full details including default_value
 */
export async function getAttributeDefinitionById(objectType, attributeId, realm) {
    try {
        const sandbox = getSandboxConfig(realm);

        return await withLoadShedding(
            async () => {
                const token = await getOAuthToken(sandbox);
                const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/system_object_definitions/${objectType}/attribute_definitions/${encodeURIComponent(attributeId)}`;
                const headers = buildApiHeaders(token);
                const response = await axios.get(url, { headers });
                return response.data;
            },
            {
                maxRetries: 3,
                onRetry: (attempt, delay) => {
                    console.log(`Rate limited on ${attributeId}. Retry ${attempt}/3 in ${delay / 1000}s...`);
                }
            }
        );
    } catch (error) {
        logError(`Failed to fetch attribute ${attributeId}: ${error.response?.data?.message || error.message}`);
        return null;
    }
}

// ============================================================================
// ATTRIBUTE GROUPS
// Manage attribute group definitions and membership
// ============================================================================

/**
 * Fetch all attribute groups for a system object type with pagination
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Array>} Array of attribute group objects
 */
export async function getAttributeGroups(objectType, realm) {
    try {
        const sandbox = getSandboxConfig(realm);
        const token = await getOAuthToken(sandbox);
        const baseUrl = `https://${sandbox.hostname}/s/-/dw/data/v25_6/system_object_definitions/${objectType}/attribute_groups`;
        const allGroups = await paginatedApiFetch(baseUrl, token, 200);
        console.log(`Found ${allGroups.length} total attribute groups for ${objectType}`);
        return allGroups;
    } catch (error) {
        logError(`Failed to fetch attribute groups: ${error.response?.data?.message || error.message}`);
        return [];
    }
}

// ============================================================================
// PREFERENCE SEARCH
// Query and retrieve actual preference values from sites
// ============================================================================

/**
 * Get site preference values for a specific group on a specific site
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} siteId - Site identifier
 * @param {string} groupId - Attribute group identifier
 * @param {string} instanceType - Instance type for preference scope
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Preference group object with values
 */
export async function getSitePreferencesGroup(siteId, groupId, instanceType, realm) {
    try {
        const sandbox = getSandboxConfig(realm);
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/sites/${encodeURIComponent(siteId)}/site_preferences/preference_groups/${encodeURIComponent(groupId)}/${encodeURIComponent(instanceType)}`;
        const headers = buildApiHeaders(token);
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        const msg = error.response?.data?.message || error.message;
        logError(`Failed to fetch site preferences for group ${groupId}: ${msg}`);
        return null;
    }
}
