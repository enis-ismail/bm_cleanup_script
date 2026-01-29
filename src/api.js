import axios from 'axios';
import fs from 'fs';

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
    try {
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
    } catch (error) {
        console.error('Error getting OAuth token:', error.response?.data || error.message);
        throw error;
    }
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
export async function getAllSites(sandbox) {
    try {
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
export async function getSiteById(siteId, sandbox) {
    try {
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
 * @returns {Promise<Array>} Array of attribute definition objects
 */
export async function getSitePreferences(objectType, sandbox) {
    try {
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

        console.log(`Found ${allAttributes.length} total attributes for ${objectType}`);
        return allAttributes;
    } catch (error) {
        console.error('Error fetching site preferences:', error.response?.data || error.message);
        return [];
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
export async function getAttributeGroups(objectType, sandbox) {
    try {
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

/**
 * Retrieve detailed information for a specific attribute group
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} objectType - SFCC system object type
 * @param {string} attributeGroupId - Group identifier
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Attribute group object with metadata
 */
export async function getAttributeGroupById(objectType, attributeGroupId, sandbox) {
    try {
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/system_object_definitions/${objectType}/attribute_groups/${encodeURIComponent(attributeGroupId)}`;

        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // Log full response to file
        const logData = {
            request: {
                url: url,
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer [REDACTED]',
                    'Content-Type': 'application/json'
                }
            },
            response: {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data
            }
        };
        const filename = `${attributeGroupId}_response.json`;
        fs.writeFileSync(filename, JSON.stringify(logData, null, 2));
        console.log(`Full response logged to: ${filename}`);

        return response.data;
    } catch (error) {
        console.error(`Error fetching attribute group ${attributeGroupId}:`, error.response?.data || error.message);
        return null;
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
export async function getSitePreferencesGroup(siteId, groupId, instanceType, sandbox) {
    try {
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

/**
 * Search all preferences within a group using preference_search endpoint
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} groupId - Attribute group identifier
 * @param {string} instanceType - Instance type for preference scope
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Search results with preferences array
 */
export async function getPreferencesInGroup(groupId, instanceType, sandbox) {
    try {
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/site_preferences/preference_groups/${encodeURIComponent(groupId)}/${encodeURIComponent(instanceType)}/preference_search`;

        // Use a match-all query to return every preference in the group; omit select for full records
        const payload = {
            query: { match_all_query: {} }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error(`Error searching preferences for group ${groupId}:`, error.response?.data || error.message);
        return null;
    }
}

/**
 * Search for a single preference by ID across all groups
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {string} preferenceId - Preference identifier
 * @param {string} instanceType - Instance type for preference scope
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Search result with matches, or null if request fails
 */
export async function getPreferenceById(preferenceId, instanceType, sandbox) {
    try {
        const token = await getOAuthToken(sandbox);
        const url = `https://${sandbox.hostname}/s/-/dw/data/v25_6/site_preferences/preference_search/${encodeURIComponent(instanceType)}`;

        const payload = {
            query: {
                term_query: {
                    fields: ['id'],
                    operator: 'is',
                    values: [preferenceId]
                }
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error(`Error searching preference ${preferenceId}:`, error.response?.data || error.message);
        return null;
    }
}
