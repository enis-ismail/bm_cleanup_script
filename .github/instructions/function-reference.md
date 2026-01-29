# Function Reference & Implementation Guide

This document provides detailed explanations of all script functions, what they do, how they work, and their data flow.

---

## OCAPI Authentication

### getOAuthToken(sandbox)
**Purpose:** Obtains OAuth 2.0 access token for all OCAPI requests.

**Process:**
1. Encode client credentials (clientId:clientSecret) as Base64
2. POST to Account Manager OAuth endpoint with grant_type=client_credentials
3. Extract and return access_token from response

**Data Flow:** Used by all data retrieval functions as the first step to authorize API access.

**Returns:** OAuth bearer token (valid ~30 minutes)

---

## Site Management

### getAllSites(sandbox)
**Purpose:** Retrieves complete list of sites from the SFCC instance.

**Process:**
1. Authenticate with getOAuthToken()
2. Call OCAPI /sites endpoint
3. Extract site array from response

**Data Flow:** Site IDs feed into getSiteById() and getSitePreferencesGroup() for detailed data retrieval.

**Returns:** Array of site objects with id, _type, and metadata

---

### getSiteById(siteId, sandbox)
**Purpose:** Fetches complete configuration for a specific site by ID.

**Includes:** Site metadata, settings, cartridge paths, allowed currencies, and custom attributes.

**Data Flow:** Site details (especially cartridges) are used in preference usage analysis.

**Returns:** Site object with full configuration, or null if not found

---

## Attribute & Preference Definitions

### getSitePreferences(objectType, sandbox)
**Purpose:** Retrieves all attribute definitions for a SFCC object type with pagination.

**Key Details:**
- Custom attributes start with "c_" prefix
- Discovers all available site preferences
- Handles pagination (200 items per page)

**Process:**
1. Authenticate with OAuth token
2. Paginate through /attribute_definitions endpoint
3. Accumulate all attributes until reaching total count
4. Return complete list

**Data Flow:** Attribute definitions feed into buildPreferenceMeta() for metadata enrichment and used by summarize-preferences command.

**Returns:** Array of attribute definition objects with id, display_name, value_type, default_value, field_length

---

### getAttributeGroups(objectType, sandbox)
**Purpose:** Retrieves all attribute groups that organize related preferences in Business Manager.

**Key Details:**
- Each group contains multiple preference attributes
- Groups allow logical organization of related preferences
- Uses pagination (200 items per page)

**Process:**
1. Authenticate with OAuth token
2. Paginate through /attribute_groups endpoint
3. Accumulate all groups until reaching total count

**Data Flow:** Groups are used to structure preference queries and organize output CSVs.

**Returns:** Array of attribute group objects with id, display_name, description, attribute_definitions

---

### getAttributeGroupById(objectType, groupId, sandbox)
**Purpose:** Fetches complete definition for a specific attribute group.

**Includes:** Group metadata and full list of member attribute IDs.

**Process:**
1. Authenticate with OAuth token
2. Call /attribute_groups/{id} endpoint
3. Write full response to {groupId}_response.json for debugging/inspection

**Data Flow:** Used when detailed group information is needed for analysis.

**Returns:** Complete attribute group object with all metadata

**Example:**
```javascript
const group = await getAttributeGroupById("SitePreferences", "PaymentSettings", sandbox)
// Returns: {id: "PaymentSettings", attribute_definitions: [...], ...}
// Creates file: PaymentSettings_response.json
```

---

## Site Preference Values

### getSitePreferencesGroup(siteId, groupId, instanceType, sandbox)
**Purpose:** Retrieves actual configured values (not definitions) for all preferences in a group on a specific site.

**Key Details:**
- Shows what's actually set in that site's configuration
- Different from definitions - this is the real data
- Instance types: "site_preference_default_instance" for site level

**Data Flow:** Feeds into processSitesAndGroups() which collects values across all sites for analysis.

**Returns:** Preference group object with actual values set for that site

---

### getPreferencesInGroup(groupId, instanceType, sandbox)
**Purpose:** Searches all preferences within a group using SFCC's search API.

**Key Details:**
- Returns preference values regardless of site
- Uses match_all_query to get every preference in group
- Alternative to iterating through each site individually

**Process:**
1. Authenticate with OAuth token
2. POST to /preference_search with match_all_query
3. Return full preference records

**Data Flow:** Used when comprehensive group-level data is needed.

**Returns:** Search results with hits array containing preference objects

---

### getPreferenceById(preferenceId, instanceType, sandbox)
**Purpose:** Searches for a single preference by ID without knowing which group it belongs to.

**Key Details:**
- Faster than fetching all groups when you know the preference ID
- Uses term_query filtering on ID field
- Returns 0 or 1 match

**Process:**
1. Authenticate with OAuth token
2. POST to /preference_search with term_query for ID
3. Return search results

**Data Flow:** Used for targeted preference lookups and validation.

**Returns:** Search result with hits array (0-1 matches) or null if request fails

---

## Data Export Functions

### exportSitesCartridgesToCSV(sandbox)
**Purpose:** Creates CSV inventory of all sites and their cartridge paths.

**Output File:** `results/{realm}/active_site_cartridges_list.csv`

**CSV Format:**
- Column 1: Site ID
- Column 2: Cartridge paths (semicolon-separated)

**Process:**
1. Fetch all sites from SFCC
2. Fetch detailed info for each site (parallel requests)
3. Extract site ID and cartridge paths
4. Write to CSV file

**Data Flow:** Provides audit trail of which cartridges are deployed on each site.

**Example:**
```javascript
await exportSitesCartridgesToCSV({
  hostname: "bcwr-080.sandbox.com",
  clientId: "...",
  clientSecret: "..."
})
// Creates: results/bcwr-080/active_site_cartridges_list.csv
```

---

### exportAttributesToCSV(allAttributes, hostname)
**Purpose:** Creates CSV catalog of all preference definitions.

**Output File:** `results/{realm}/{realm}_site_preferences.csv`

**CSV Columns:** id, default_value, description, and other attribute fields

**Data Handling:**
- Commas in values replaced with semicolons
- Handles missing default_value by checking 'default' fallback
- Removes 'type' column from output

**Data Flow:** Provides comprehensive documentation of available preferences.

---

## Usage Analysis Functions

### writeUsageCSV(realmDir, realm, instanceType, usageRows, preferenceMeta)
**Purpose:** Creates detailed CSV showing which preferences have which values on each site.

**Output File:** `results/{realm}/{realm}_{instanceType}_preferences_usage.csv`

**CSV Structure:**
- Base columns: groupId, preferenceId, defaultValue, description, type
- Dynamic columns: value_{SiteID} for each site (e.g., value_SiteA, value_SiteB)

**Process:**
1. Collect all unique site IDs from usage data
2. Group preferences by preferenceId (merge multi-site data)
3. Create header with base columns + dynamic site value columns
4. Write rows with all preference details and site-specific values

**Data Handling:**
- Uses compactValue() to truncate long values
- Escapes quotes and wraps cells in double quotes
- Empty cells for sites where preference has no value

**Data Flow:** Detailed view of preference configuration across all sites.

---

### writeMatrixCSV(realmDir, realm, instanceType, preferenceMatrix, allSiteIds)
**Purpose:** Creates "X marks the spot" matrix showing which preferences are used on which sites.

**Output File:** `results/{realm}/{realm}_{instanceType}_preferences_matrix.csv`

**CSV Structure:**
- Column 1: preferenceId
- Columns 2+: One column per site (site IDs as headers)
- Cell values: "X" if preference has value on that site, empty if not

**Process:**
1. Create header row with preferenceId + all site IDs
2. For each preference, create row with "X" or "" for each site
3. Quote and escape all values for CSV safety
4. Write to output file

**Data Flow:** Quick visual overview of preference usage patterns. Used by check-preferences command to identify unused preferences.

---

## Data Processing Functions

### buildPreferenceMeta(preferenceDefinitions)
**Purpose:** Converts OCAPI attribute definitions into a normalized metadata lookup map.

**Key Details:**
- Indexes by preference ID for fast lookup
- Normalizes field names across different OCAPI response formats
- Extracts id, type, description, group, defaultValue

**Process:**
1. Iterate through all preference definitions
2. Extract ID from various possible field names (id, attribute_id, attributeId)
3. Normalize other fields (value_type/type, group_id/groupId, etc.)
4. Store in lookup object keyed by preference ID

**Data Flow:** Used by summarize-preferences command to enrich usage rows with type information, descriptions, and default values.

**Returns:** Map of preferenceId → {id, type, description, group, defaultValue}

---

### processSitesAndGroups(sitesToProcess, groupSummaries, sandbox, answers, preferenceMeta)
**Purpose:** Iterates through sites and their preference groups to build comprehensive usage data.

**Key Details:**
- Core data collection step for analysis
- Builds both detailed usage rows (for CSV export) and site summaries
- Filters to only preferences with non-null/empty values

**Process:**
1. Loop through each site to process
2. Fetch site details (cartridge path) via getSiteById()
3. For each attribute group, fetch preference values via getSitePreferencesGroup()
4. Filter to only preferences with non-null/empty values
5. Build usage rows with site, group, preference, and value data
6. Accumulate site summaries with group-level value collections

**Data Flow:** Usage rows feed into writeUsageCSV() for detailed CSV, and into buildPreferenceMatrix() for the matrix view.

**Returns:** Object with usageRows (array of usage records) and siteSummaries (array of site-level summaries)

---

### buildPreferenceMatrix(allPrefIds, allSiteIds, usageRows)
**Purpose:** Creates 2D boolean matrix showing which preferences are used on which sites.

**Key Details:**
- Rows = preferences, Columns = sites
- Boolean values indicate if preference has value on that site
- Used for "X marks the spot" matrix CSV output

**Process:**
1. Initialize matrix with all preferences having false for every site
2. Iterate through usage rows (preferences that have values)
3. Mark corresponding preference-site cells as true
4. Return complete matrix structure

**Data Flow:** Matrix is consumed by writeMatrixCSV() which converts boolean values to "X" markers. This matrix is then read by check-preferences command to identify unused preferences.

**Returns:** Array of preference matrix objects: [{preferenceId: "c_enableApplePay", sites: {RefArch: true, SiteGenesis: false}}]

---

## Configuration Management

### getSandboxConfig(realmName)
**Purpose:** Retrieves full configuration object for a named realm from config.json.

**Used to:** Establish connections to SFCC instances with hostname and credentials.

**Returns:** Sandbox configuration object: {name, hostname, clientId, clientSecret}

---

### getAvailableRealms()
**Purpose:** Returns array of all configured realm identifiers from config.json.

**Used for:** Presenting selection menus and validating realm names.

**Returns:** Array of realm names like ["bcwr-080", "prod-realm"]

---

### addRealmToConfig(name, hostname, clientId, clientSecret)
**Purpose:** Registers a new SFCC sandbox realm with credentials to config.json.

**Key Details:**
- Creates config.json if it doesn't exist
- Prevents duplicate realm names

**Returns:** true if successful, false otherwise

---

### removeRealmFromConfig(realmName)
**Purpose:** Deletes a realm entry from the configuration file.

**Validates:** That the realm exists before attempting removal.

**Returns:** Promise<boolean> true if successful, false otherwise

---

## File System Helpers

### deriveRealm(hostname)
**Purpose:** Converts hostname like "bcwr-080.sandbox.com" to just "bcwr-080".

**Used for:** Deriving simple identifiers from full hostnames for file naming.

**Returns:** Extracted realm name or "realm" as fallback

---

### ensureRealmDir(realm)
**Purpose:** Creates realm-specific directory structure in results folder.

**Key Details:**
- Creates all parent directories recursively if they don't exist
- Used before writing realm-specific output files

**Returns:** Absolute path to the created/verified directory

---

### writeTestOutput(filename, data, options)
**Purpose:** Saves test/debug data to JSON file for inspection.

**Used during:** Development to capture API responses and intermediate data.

**Options:**
- consoleOutput: Whether to log to console (default: true)
- preview: Optional data preview to display in console

**Returns:** void

---

## Data Normalization

### normalizeId(id)
**Purpose:** Removes SFCC custom attribute prefix "c_" from preference IDs.

**Key Details:**
- SFCC custom attributes are prefixed with "c_" in API responses
- This function gets the actual attribute name

**Returns:** Normalized ID without "c_" prefix

---

### isValueKey(key)
**Purpose:** Filters out SFCC metadata keys to identify actual preference values.

**Key Details:**
- SFCC API responses include metadata like "_v", "_type", "link", "site"
- This function identifies which keys are actual data

**Returns:** true if key represents preference data, false if metadata

---

### compactValue(val)
**Purpose:** Truncates and formats values for safe CSV output.

**Handles:**
- null/undefined → empty string
- Objects → JSON string (truncated if > 200 chars)
- Long strings → truncated with ellipsis

**Data Flow:** Used by CSV export functions to ensure values fit safely in cells.

**Returns:** Formatted, truncated string safe for CSV

---

## Matrix File Discovery

### findAllMatrixFiles()
**Purpose:** Scans results folder to locate all preference matrix CSV files by realm.

**Expected Pattern:** `results/{realm}/{realm}_sandbox_preferences_matrix.csv`

**Data Flow:** Used by check-preferences command to find matrices from all realms.

**Returns:** Array of objects: [{realm: "bcwr-080", matrixFile: "/path/to/matrix.csv"}]

---

## CSV Parsing

### parseCSVToNestedArray(filePath)
**Purpose:** Reads preference matrix CSV and converts to 2D array structure.

**CSV Structure:**
- Row 0: Header row (preferenceId, site1, site2, ...)
- Row 1+: Data rows (preferenceId, "X" or "", "X" or "", ...)
- "X" marker = preference has value on that site

**Handles:** Quoted values and removes surrounding quotes from CSV cells

**Returns:** 2D array where [0] = header, [1+] = data rows

---

## Preference Analysis

### findUnusedPreferences(csvData)
**Purpose:** Identifies preferences with no values set across any site.

**Analysis Logic:**
- Skip header row (index 0)
- For each data row, check columns 1+ for "X" or "x"
- If no "X" found in any column, preference is unused

**Returns:** Array of unused preference IDs

---

### writeUnusedPreferencesFile(realmDir, realm, unusedPreferences)
**Purpose:** Creates human-readable report of unused preferences for a realm.

**Output File:** `{realmDir}/{realm}_unused_preferences.txt`

**File Format:**
- Header with realm name and generation timestamp
- Total count of unused preferences
- List of all unused preference IDs (one per line)

**Returns:** Absolute path to the created file

---

## Data Summaries

### buildPreferenceMatrix (in summarizeHelper.js)
**Purpose:** Same as buildPreferenceMatrix above - creates boolean matrix of preference usage.

**Used by:** Multiple workflows for usage analysis and matrix generation.
