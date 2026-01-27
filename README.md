# Cleanup Script - OCAPI Tools

Tools for working with Salesforce Commerce Cloud (SFCC) OCAPI to manage site preferences and attribute groups.

## Prerequisites

- **Node.js** (v14 or higher)
- **npm** (comes with Node.js)

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:
```bash
npm install
```

## Configuration

### Step 1: OCAPI API Client Configuration in Business Manager

Before using these scripts, you must configure your OCAPI client in the Business Manager with the required resources. 

**Steps:**
1. Open Business Manager → Administration → Open Commerce API Settings
2. Find your client configuration in the data object
3. Add the resource objects from `ocapi_config.json` to your client's resources array
4. Ensure your client has the correct read/write permissions (`(**)` for all attributes)
5. Save the configuration

The resources needed are:
- `/sites` and `/sites/*` (GET)
- `/system_object_definitions/*` and `/system_object_definitions/*/attribute_definitions` (GET)
- `/system_object_definitions/*/attribute_groups` and `/system_object_definitions/*/attribute_groups/*` (GET)
- `/sites/*/site_preferences/preference_groups/*/*` (GET)
- `/site_preferences/preference_groups/*/*/preference_search` (POST)
- `/site_preferences/preference_search/*` (POST)

See `ocapi_config.json` for the exact format to add to your Business Manager configuration.

### Step 2: Obtain Client Credentials

Before adding your realm, you need to obtain your Client ID and Client Secret from your Salesforce Commerce Cloud account.

**To find your API Client:**
1. Log in to your Salesforce account manager
2. Navigate to **API Client** section
3. If you have an existing box listed, note the **API Client ID** — this is your `clientId`
4. Retrieve the **Client Secret** from the same location — this is your `clientSecret`

**If your box is not listed:**
- You will need to create a new API Client in your account manager

**If you cannot see the API Client section:**
- You lack the necessary access permissions
- Contact your Salesforce administrator to grant you API Client access

### Step 3: Configure Your Realm/Sandbox

You must add your sandbox realm to the `config.json` file before running commands. You can do this in two ways:

**Option 1: Using the CLI (Recommended)**
```bash
node src/ocapi.js add-realm
```
This will prompt you to enter:
- Realm name (e.g., `staging`, `production`)
- Hostname (e.g., `realm-123.sandbox.example.com`)
- Client ID (the API Client ID from your account manager)
- Client Secret (from your API Client in account manager)

**Option 2: Manual Configuration**
Edit `config.json` directly and add your realm to the `realms` array:
```json
{
  "realms": [
    {
      "name": "your-realm-name",
      "hostname": "your-hostname.com",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret"
    }
  ]
}
```

### Authentication

OAuth credentials (Client ID and Client Secret) must be configured for each realm. The scripts automatically handle OAuth token retrieval using your configured credentials. Tokens are obtained on demand for each API request.

**Important:** Keep your Client Secret secure. Do not commit `config.json` to version control if it contains sensitive credentials.

## Output Files

When running commands that export data, files are organized by realm:

```
your-realm-name/
├── active_site_cartridges_list.csv       # Site IDs and their cartridge paths
├── sandbox_preferences_summary.json      # Summary of all preference groups
├── sandbox_preferences_usage.csv         # Preferences × Sites matrix (X marks explicit values)
├── sandbox_preferences_matrix.csv        # All preferences with their attributes
└── site_preferences.csv                  # Detailed site preference values
```

Each realm creates its own folder, allowing you to work with multiple sandboxes simultaneously.

## API Capabilities

### 1. Retrieve Sites
- **`getAllSites(sandbox)`** - Get all sites from the sandbox
- **`getSiteById(siteId, sandbox)`** - Get a specific site by ID

### 2. Retrieve Preference/Attribute Groups
- **`getAttributeGroups(objectType, sandbox)`** - Get all preference/attribute groups for a given object type (e.g., SitePreferences)
- **`getAttributeGroupById(objectType, groupId, sandbox)`** - Get details of a specific attribute group

### 3. Retrieve Preferences in a Group
- **`getPreferencesInGroup(groupId, instanceType, sandbox, query)`** - Get all preferences within a specific group using the preference_search endpoint
  - Endpoint: `/s/-/dw/data/v25_6/site_preferences/preference_groups/{group_id}/{instance_type}/preference_search`

### 4. Retrieve Site-Specific Preference Values
- **`getSitePreferencesGroup(siteId, groupId, instanceType, sandbox)`** - Get the preference group data for a specific site
  - Endpoint: `/s/-/dw/data/v25_6/sites/{site_id}/site_preferences/preference_groups/{group_id}/{instance_type}`
- **`getSitePreferences(objectType, sandbox)`** - Get site preferences/attributes for an object type

## Complete Workflow

The available functions enable a complete workflow:

1. **List all sites** using `getAllSites()`
2. **List all preference groups** using `getAttributeGroups()`
3. **Get preferences in each group** using `getPreferencesInGroup()`
4. **Get actual values per site** using `getSitePreferencesGroup()`

This gives you:
- The preference structure (which groups exist, which preferences are in each group)
- The values of those preferences for each specific site
- Ability to identify and manage preference configurations across multiple sites

## Instance Types

When querying preferences, specify one of these instance types:
- `sandbox` - Sandbox environment
- `staging` - Staging environment
- `development` - Development environment
- `production` - Production environment

## CLI Commands

Once your realm is configured, you can use the following commands:

### Realm Management
```bash
node src/ocapi.js add-realm
```
Add a new realm to config.json.

```bash
node src/ocapi.js remove-realm
```
Remove a realm from config.json.

### Core Commands
```bash
node src/ocapi.js list-sites
```
Lists all sites and exports cartridge paths to CSV.

```bash
node src/ocapi.js get-preferences
```
Retrieves site preferences from OCAPI.

```bash
node src/ocapi.js summarize-preferences
```
Builds a comprehensive export of preference groups, preferences across all sites, and site-specific preference values into CSV files.

### Testing Commands
```bash
node src/ocapi.js test-preference-search
```
Tests the preference search endpoint with a specific preference group.

```bash
node src/ocapi.js test-site-preferences-group
```
Tests retrieving site-specific preference values for a group.
