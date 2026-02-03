import axios from 'axios';
import { processBatch, withLoadShedding } from './helpers/batch.js';
import { getSandboxConfig } from './helpers.js';
import { getApiConfig } from './helpers/constants.js';

/* eslint-disable no-undef */

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
    return withLoadShedding(
        async () => {
            const tokenUrl = 'https://account.demandware.com/dwsso/oauth2/access_token';
            const credentials = Buffer.from(`${sandbox.clientId}:${sandbox.clientSecret}`).toString('base64');

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

        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const sites = response.data.data || [];
        console.log(`Found ${sites.length} sites`);

        return sites;
    } catch (error) {
        console.error('Error fetching sites:', error.response?.data || error.message);
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
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching site ${siteId}:`, error.response?.data || error.message);
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
        let allAttributes = [];
        let start = 0;
        const count = 200;
        let total = 0;

        do {
            const url = `https://${sandbox.hostname}/s/-/dw/data/v19_5/system_object_definitions/${objectType}/attribute_definitions?start=${start}&count=${count}`;
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const attributes = response.data.data || [];
            total = response.data.total || attributes.length;

            allAttributes = allAttributes.concat(attributes);
            start += attributes.length;

            console.log(`Fetched ${allAttributes.length} of ${total} attributes...`);
            if (attributes.length === 0 || allAttributes.length >= total) {
                break;
            }
        } while (allAttributes.length < total);

        const listTime = Date.now() - startTime;
        console.log(
            `Found ${allAttributes.length} total attributes for ${objectType} ` +
            `(${(listTime / 1000).toFixed(2)}s)`
        );

        // If includeDefaults is true, fetch each attribute individually to get default_value
        if (includeDefaults) {
            console.log('\nFetching full details with default values (parallel batches)...');
            const detailStartTime = Date.now();
            const apiConfig = getApiConfig(sandbox.instanceType);

            const detailedAttributes = await processBatch(
                allAttributes,
                (attr) => getAttributeDefinitionById(objectType, attr.id, realm),
                apiConfig.batchSize,
                (progress, total, rate) => {
                    console.log(
                        `Fetched detailed info for ${progress} of ${total} ` +
                        `attributes (${rate.toFixed(1)} attrs/sec)...`
                    );
                },
                apiConfig.batchDelayMs
            );

            const detailTime = Date.now() - detailStartTime;
            console.log(
                `Completed fetching ${detailedAttributes.length} attributes with ` +
                `full details (${(detailTime / 1000).toFixed(2)}s)`
            );
            return detailedAttributes;
        }

        return allAttributes;
    } catch (error) {
        console.error('Error fetching site preferences:', error.response?.data || error.message);
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

                const response = await axios.get(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

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
        console.error(`Error fetching attribute ${attributeId}:`, error.response?.data || error.message);
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
        let allGroups = [];
        let start = 0;
        const count = 200;
        let total = 0;

        do {
            const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/system_object_definitions/${objectType}/attribute_groups?start=${start}&count=${count}`;
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const groups = response.data.data || [];
            total = response.data.total || groups.length;

            allGroups = allGroups.concat(groups);
            start += groups.length;

            console.log(`Fetched ${allGroups.length} of ${total} attribute groups...`);

            if (groups.length === 0 || allGroups.length >= total) {
                break;
            }
        } while (allGroups.length < total);

        console.log(`Found ${allGroups.length} total attribute groups for ${objectType}`);
        return allGroups;
    } catch (error) {
        console.error('Error fetching attribute groups:', error.response?.data || error.message);
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

        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error(`Error fetching site preferences for group ${groupId}:`, error.response?.data || error.message);
        return null;
    }
}
