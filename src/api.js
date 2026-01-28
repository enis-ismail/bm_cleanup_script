import axios from 'axios';
import fs from 'fs';

/* eslint-disable no-undef */

// ============================================================================
// OAUTH AUTHENTICATION
// Handle OAuth token generation for OCAPI access
// ============================================================================

/**
 * Obtain OAuth 2.0 access token for OCAPI requests
 *
 * Purpose: Authenticates with SFCC Account Manager using client credentials
 * grant flow to obtain a bearer token for subsequent OCAPI calls.
 *
 * Process:
 * 1. Encode client credentials as Base64 for Basic auth
 * 2. POST to Account Manager OAuth endpoint with grant_type=client_credentials
 * 3. Extract access_token from response
 *
 * @param {Object} sandbox - Sandbox configuration object from getSandboxConfig()
 * @returns {Promise<string>} OAuth bearer token (valid for ~30 minutes)
 * @throws {Error} If authentication fails or credentials are invalid
 *
 * @example
 * const sandbox = getSandboxConfig("bcwr-080")
 * const token = await getOAuthToken(sandbox)
 * // Returns: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *
 * Data Flow: Used by all data retrieval functions (getAllSites, getSitePreferences, etc.)
 * as the first step to authorize API access.
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
 *
 * Purpose: Retrieves complete list of sites (both storefront and business manager)
 * from OCAPI. Used to discover available sites before fetching their preferences.
 *
 * Process:
 * 1. Authenticate with getOAuthToken()
 * 2. Call OCAPI /sites endpoint
 * 3. Extract site array from response.data.data
 *
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Array>} Array of site objects, each containing:
 *   - id: Site identifier (e.g., "RefArch", "SiteGenesis")
 *   - _type: Object type ("site")
 *   - Various site metadata fields
 * @returns {Promise<Array>} Empty array if request fails
 *
 * @example
 * const sites = await getAllSites(sandbox)
 * // Returns: [{id: "RefArch", _type: "site", ...}, {id: "SiteGenesis", ...}]
 *
 * Data Flow: Site IDs are used to fetch site-specific preferences via getSiteById()
 * or getSitePreferencesGroup().
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
 *
 * Purpose: Fetches complete site object including metadata, settings, and
 * configuration for a single site by its ID.
 *
 * @param {string} siteId - Site identifier (e.g., "RefArch")
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Site object with full configuration, or null if not found
 *
 * @example
 * const site = await getSiteById("RefArch", sandbox)
 * // Returns: {id: "RefArch", _type: "site", allowed_currencies: [...], ...}
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
 *
 * Purpose: Retrieves complete list of attributes (both system and custom) for
 * a given SFCC object type. Custom attributes start with "c_" prefix. This is
 * the primary method to discover all available site preferences.
 *
 * Process:
 * 1. Authenticate with OAuth token
 * 2. Paginate through /attribute_definitions endpoint (200 per page)
 * 3. Accumulate all attributes until reaching total count
 * 4. Return complete list of attribute definitions
 *
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Array>} Array of attribute definition objects, each containing:
 *   - id: Attribute identifier (e.g., "c_enableApplePay")
 *   - display_name: Human-readable name
 *   - value_type: Data type (string, boolean, number, etc.)
 *   - default_value: Default value if set
 *   - field_length: Max length for string types
 * @returns {Promise<Array>} Empty array if request fails
 *
 * @example
 * const attrs = await getSitePreferences("SitePreferences", sandbox)
 * // Returns: [
 * //   {id: "c_enableApplePay", value_type: "boolean", default_value: {value: false}},
 * //   {id: "c_paymentGateway", value_type: "string", field_length: 256}
 * // ]
 *
 * Data Flow: Used by summarize command to get all preference definitions before
 * checking their values across sites.
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
 *
 * Purpose: Retrieves the complete list of attribute groups that organize
 * related preferences together in Business Manager. Each group can contain
 * multiple preference attributes.
 *
 * Process:
 * 1. Authenticate with OAuth token
 * 2. Paginate through /attribute_groups endpoint (200 per page)
 * 3. Accumulate all groups until reaching total count
 *
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Array>} Array of attribute group objects, each containing:
 *   - id: Group identifier (e.g., "PaymentSettings")
 *   - display_name: Human-readable group name
 *   - description: Group description
 *   - attribute_definitions: Array of attribute IDs in this group
 * @returns {Promise<Array>} Empty array if request fails
 *
 * @example
 * const groups = await getAttributeGroups("SitePreferences", sandbox)
 * // Returns: [
 * //   {id: "PaymentSettings", display_name: "Payment Settings",
 * //    attribute_definitions: ["c_enableApplePay", "c_paymentGateway"]}
 * // ]
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
 *
 * Purpose: Fetches complete attribute group definition including all member
 * attributes. Also logs full response to JSON file for debugging.
 *
 * Process:
 * 1. Authenticate with OAuth token
 * 2. Call /attribute_groups/{id} endpoint
 * 3. Write full response to {groupId}_response.json for inspection
 *
 * @param {string} objectType - SFCC system object type (e.g., "SitePreferences")
 * @param {string} attributeGroupId - Group identifier
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Attribute group object with complete metadata, or null if not found
 *
 * @example
 * const group = await getAttributeGroupById("SitePreferences", "PaymentSettings", sandbox)
 * // Returns: {id: "PaymentSettings", attribute_definitions: [...], ...}
 * // Creates file: PaymentSettings_response.json
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
 *
 * Purpose: Retrieves the actual configured values (not just definitions) for
 * all preferences within a group for a given site. This shows what's actually
 * set in that site's configuration.
 *
 * @param {string} siteId - Site identifier (e.g., "RefArch")
 * @param {string} groupId - Attribute group identifier (e.g., "PaymentSettings")
 * @param {string} instanceType - Instance type ("site_preference_default_instance" for site-level)
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Preference group object with values, or null if not found
 *
 * @example
 * const prefs = await getSitePreferencesGroup("RefArch", "PaymentSettings", "site_preference_default_instance", sandbox)
 * // Returns: {c_enableApplePay: {value: true}, c_paymentGateway: {value: "stripe"}}
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
 *
 * Purpose: Uses SFCC's search API to retrieve all preferences in a group
 * regardless of site. This returns preference values for the specified
 * instance type (site vs organization level).
 *
 * Process:
 * 1. Authenticate with OAuth token
 * 2. POST to /preference_search with match_all_query
 * 3. Return full preference records
 *
 * @param {string} groupId - Attribute group identifier
 * @param {string} instanceType - Instance type ("site_preference_default_instance" or "organization")
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Search results with hits array containing preference objects
 *
 * @example
 * const result = await getPreferencesInGroup("PaymentSettings", "site_preference_default_instance", sandbox)
 * // Returns: {hits: [{id: "c_enableApplePay", value: true}, ...]}
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
 *
 * Purpose: Locates a specific preference using SFCC's search API without
 * needing to know which group it belongs to. Returns the preference's
 * current value and metadata.
 *
 * Process:
 * 1. Authenticate with OAuth token
 * 2. POST to /preference_search with term_query filtering on ID field
 * 3. Return search results (should contain 0 or 1 match)
 *
 * @param {string} preferenceId - Preference identifier (e.g., "c_enableApplePay")
 * @param {string} instanceType - Instance type ("site_preference_default_instance" or "organization")
 * @param {Object} sandbox - Sandbox configuration object
 * @returns {Promise<Object|null>} Search result with hits array, or null if request fails
 *
 * @example
 * const result = await getPreferenceById("c_enableApplePay", "site_preference_default_instance", sandbox)
 * // Returns: {hits: [{id: "c_enableApplePay", value: true, group: "PaymentSettings"}], total: 1}
 *
 * Data Flow: Used when checking specific preference values without iterating
 * through groups. Faster than fetching all groups when you know the preference ID.
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
