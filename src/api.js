import axios from 'axios';
import { processBatch, withLoadShedding } from './helpers/batch.js';
import { getSandboxConfig } from './helpers.js';
import { getApiConfig } from './helpers/constants.js';
import { logError, logRateLimitCountdown } from './helpers/log.js';
import { generateBackupFromDefinitions } from './helpers/preferenceBackup.js';
import { fetchDetailedAttributes, loadCachedBackup } from './helpers/preferenceHelper.js';

/* eslint-disable no-undef */

// ============================================================================
// API REQUEST HELPERS
// Common patterns for OCAPI requests
// ============================================================================

/**
 * Build standard authorization headers for OCAPI requests
 * @param {string} token - OAuth bearer token
 * @param {string} [ifMatch] - Optional If-Match header for PATCH/PUT operations
 * @returns {Object} Headers object with authorization
 * @private
 */
function buildApiHeaders(token, ifMatch = null) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    if (ifMatch !== null) {
        headers['If-Match'] = ifMatch;
    }
    return headers;
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
                logRateLimitCountdown(delay, attempt);
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
 * @param {string} realm - Realm name
 * @param {boolean} includeDefaults - If true, fetch each attribute individually to get default_value
 * @param {boolean} [useCachedBackup] - If true, use cached backup; if false, fetch fresh; if undefined, always fetch
 * @returns {Promise<Array>} Array of attribute definition objects
 */
export async function getSitePreferences(objectType, realm, includeDefaults = false, useCachedBackup = undefined) {
    try {
        const sandbox = getSandboxConfig(realm);

        // Try to use cached backup if requested and available
        if (includeDefaults && useCachedBackup === true) {
            const cachedAttributes = await loadCachedBackup(realm, sandbox.instanceType, objectType);
            if (cachedAttributes) {
                console.log(`\n✓ Using cached backup for ${realm} (skipping API fetch).\n`);
                return cachedAttributes;
            }
            // If cache requested but not available, fall through to fetch
            console.log(`\n⚠ Cached backup not found for ${realm}, fetching fresh data...\n`);
        }

        // Fetch basic attribute list
        const startTime = Date.now();
        const token = await getOAuthToken(sandbox);
        const baseUrl = `https://${sandbox.hostname}/s/-/dw/data/v19_5/system_object_definitions/${objectType}/attribute_definitions`;
        const allAttributes = await paginatedApiFetch(baseUrl, token, 200);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`Found ${allAttributes.length} total attributes for ${objectType} (${duration}s)`);

        // Return basic list if defaults not needed
        if (!includeDefaults) {
            return allAttributes;
        }

        // Fetch detailed attributes with default values
        const detailedAttributes = await fetchDetailedAttributes(allAttributes, objectType, realm, sandbox);

        // Generate backup file for future use
        await generateBackupFromDefinitions(
            objectType,
            detailedAttributes,
            realm,
            sandbox.instanceType
        );

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
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/system_object_definitions/${objectType}/attribute_definitions/${encodeURIComponent(attributeId)}`;
        const headers = buildApiHeaders(token);
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        logError(`Failed to fetch attribute ${attributeId}: ${error.response?.data?.message || error.message}`);
        return null;
    }
}

/**
 * Update/modify an attribute definition by ID with specified HTTP method
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {string} attributeId - Attribute ID to update/delete
 * @param {string} method - HTTP method: 'patch' | 'put' | 'delete'
 * @param {Object} [payload] - Request payload (optional for delete method)
 * @param {string} realm - Realm name
 * @returns {Promise<Object|boolean|null>} Response data or boolean for delete
 */
export async function updateAttributeDefinitionById(objectType, attributeId, method, payload, realm) {
    const methodLower = method.toLowerCase();
    try {
        const sandbox = getSandboxConfig(realm);
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/system_object_definitions/${objectType}/attribute_definitions/${encodeURIComponent(attributeId)}`;

        let response;
        switch (methodLower) {
        case 'patch':
        case 'put': {
            // For PATCH/PUT, try to fetch the current attribute to get its ETag (for updates)
            const currentAttr = await getAttributeDefinitionById(objectType, attributeId, realm);
            let headers;
            if (currentAttr && currentAttr._resource_state) {
                // Attribute exists - use ETag for update
                headers = buildApiHeaders(token, currentAttr._resource_state);
            } else {
                // Attribute doesn't exist - create without ETag (for PUT creation)
                headers = buildApiHeaders(token);
            }
            if (methodLower === 'patch') {
                response = await axios.patch(url, payload, { headers });
            } else {
                response = await axios.put(url, payload, { headers });
            }
            return response.data;
        }
        case 'delete': {
            const headers = buildApiHeaders(token);
            await axios.delete(url, { headers });
            return true;
        }
        default:
            logError(`Unsupported method: ${method}. Use 'patch', 'put', or 'delete'.`);
            return null;
        }
    } catch (error) {
        logError(`Failed to ${method} attribute ${attributeId}: ${error.response?.data?.message || error.message}`);
        console.error('Full error response:', error.response?.data || error);
        return methodLower === 'delete' ? false : null;
    }
}

/**
 * Patch (partial update) an attribute definition by ID
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {string} attributeId - Attribute ID to update
 * @param {Object} payload - Partial update payload
 * @param {string} realm - Realm name
 * @returns {Promise<Object|null>} Updated attribute definition
 */
export async function patchAttributeDefinitionById(objectType, attributeId, payload, realm) {
    return updateAttributeDefinitionById(objectType, attributeId, 'patch', payload, realm);
}

/**
 * Replace (full update) an attribute definition by ID
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {string} attributeId - Attribute ID to update
 * @param {Object} payload - Full update payload
 * @param {string} realm - Realm name
 * @returns {Promise<Object|null>} Updated attribute definition
 */
export async function putAttributeDefinitionById(objectType, attributeId, payload, realm) {
    return updateAttributeDefinitionById(objectType, attributeId, 'put', payload, realm);
}

/**
 * Delete an attribute definition by ID
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {string} attributeId - Attribute ID to delete
 * @param {string} realm - Realm name
 * @returns {Promise<boolean>} True if deleted successfully
 */
export async function deleteAttributeDefinitionById(objectType, attributeId, realm) {
    return updateAttributeDefinitionById(objectType, attributeId, 'delete', null, realm);
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

/**
 * Patch site preference values for a specific group on a specific site
 * @param {string} siteId - Site identifier
 * @param {string} groupId - Attribute group identifier
 * @param {string} instanceType - Instance type for preference scope
 * @param {Object} payload - Preference values to update (e.g., {"c_myPref": "value"})
 * @param {string} realm - Realm name
 * @returns {Promise<Object|null>} Updated preference group object
 */
export async function patchSitePreferencesGroup(siteId, groupId, instanceType, payload, realm) {
    try {
        const sandbox = getSandboxConfig(realm);
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/sites/${encodeURIComponent(siteId)}/site_preferences/preference_groups/${encodeURIComponent(groupId)}/${encodeURIComponent(instanceType)}`;
        const headers = buildApiHeaders(token);
        const response = await axios.patch(url, payload, { headers });
        return response.data;
    } catch (error) {
        const msg = error.response?.data?.message || error.message;
        logError(`Failed to patch site preferences for group ${groupId}: ${msg}`);
        console.error('Full error response:', error.response?.data || error);
        return null;
    }
}
