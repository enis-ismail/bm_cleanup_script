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
node src/main.js add-realm
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

**Example Configuration File**
A sample configuration with dummy data is provided in `config.example.json`. You can use it as a template:
```bash
cp config.example.json config.json
```
Then edit `config.json` with your actual realm credentials.

### Authentication

OAuth credentials (Client ID and Client Secret) must be configured for each realm. The scripts automatically handle OAuth token retrieval using your configured credentials. Tokens are obtained on demand for each API request.

**Important:** Keep your Client Secret secure. Do not commit `config.json` to version control if it contains sensitive credentials.

## Output Files

Files are organized by realm and instance type:

### Backup Files
```
backup/
├── development/
│   ├── APAC_SitePreferences_backup_2026-02-12.json
│   ├── EU05_SitePreferences_backup_2026-02-12.json
│   └── ...
├── sandbox/
│   └── bcwr-080_SitePreferences_backup_2026-02-16.json
└── staging/
    └── ...
```

### Backup Downloads (Metadata XML)
```
backup_downloads/
└── sandbox_bcwr-080.dx.commercecloud.salesforce.com_meta_data_backup.xml
```

### Results Files
```
results/
├── development/
│   ├── ALL_REALMS/
│   │   ├── ALL_REALMS_cartridge_comparison.txt
│   │   ├── ALL_REALMS_unused_preferences.txt
│   │   ├── development_cartridge_preferences.txt
│   │   ├── development_preference_usage.txt
│   │   ├── development_preferences_for_deletion.txt  ← DELETION LIST
│   │   └── development_unused_preferences.txt
│   ├── APAC/
│   │   ├── APAC_active_site_cartridges_list.csv
│   │   ├── APAC_development_preferences_matrix.csv
│   │   ├── APAC_development_preferences_usage.csv
│   │   ├── APAC_unused_preferences.txt
│   │   └── APAC_used_preferences.txt
│   ├── EU05/
│   │   └── ...
│   └── ...
├── sandbox/
│   ├── ALL_REALMS/
│   │   └── sandbox_preferences_for_deletion.txt  ← DELETION LIST
│   └── bcwr-080/
│       └── ...
└── staging/
    └── ...
```

**Key Files:**
- `*_preferences_matrix.csv` - Matrix showing which sites use which preferences ("X" marks)
- `*_preferences_usage.csv` - Actual preference values per site
- `*_unused_preferences.txt` - Preferences with no values anywhere
- `*_cartridge_preferences.txt` - Which cartridges reference which preferences
- `*_preferences_for_deletion.txt` - **Safe to delete** (unused + not in code)

Each realm creates its own folder within `results/`, organized by instance type.

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
node src/main.js add-realm
```
Add a new realm to config.json.

```bash
node src/main.js remove-realm
```
Remove a realm from config.json.

### Core Commands

#### analyze-preferences
```bash
node src/main.js analyze-preferences
```
**Full preference analysis workflow** (fetch → summarize → analyze → check usage):

**Step 1:** Configure scope and options
- Select sibling repository (cartridge folder to scan)
- Select realm(s): single, by instance type, or ALL
- Configure: objectType, scope (ALL_SITES/specific site), includeDefaults
- Option to reuse existing backups (<14 days old)

**Step 2:** Fetch and summarize preferences
- Fetches all sites and attribute groups via OCAPI
- Gets site preferences for each site/group combination
- Optionally fetches detailed definitions (with default values)
- **Creates backup:** `backup/{instanceType}/{realm}_SitePreferences_backup_{date}.json`
- Generates matrix CSV ("X" marks where preference has value)
- Generates usage CSV (actual values per site)
- Identifies unused preferences (no values + no defaults)

**Step 3:** Check preference usage in cartridge code
- Scans repository cartridges for ALL active preferences
- Excludes: sites folder, .git, node_modules, deprecated cartridges
- Records which cartridges reference each preference

**Step 4:** Generate deletion candidates
A preference is marked for deletion if:
- No site has a value (no "X" in matrix)
- No default value exists
- Not referenced in any active cartridge code
- OR only referenced in deprecated cartridges

**Output Files:**
- `{instance}_unused_preferences.txt` - Preferences with no cartridge usage
- `{instance}_cartridge_preferences.txt` - Mapping of preferences → cartridges
- `{instance}_preferences_for_deletion.txt` - **THE DELETION LIST**

#### remove-preferences
```bash
node src/main.js remove-preferences
```
**Remove preferences marked for deletion** from site preferences:

**Step 1:** Load deletion list
- Select instance type (development/staging/production)
- Load `{instance}_preferences_for_deletion.txt`
- If missing, offers to run analyze-preferences first

**Step 2:** Review and confirm
- Opens deletion file in VS Code for manual review
- Shows summary (total count, top prefixes being removed)
- Requires confirmation before proceeding

**Step 3:** Verify backups (per realm)
- Checks for backup file from analyze step
- Optional: Trigger backup job on SFCC + download metadata
- Updates backup file with attribute group metadata from XML

**Step 4:** Remove preferences (⚠️ NOT YET IMPLEMENTED)
- Will call OCAPI to remove preferences
- Logs success/failure for each preference
- Keeps terminal open for monitoring

#### backup-site-preferences
```bash
node src/main.js backup-site-preferences
```
Trigger site preferences backup job on SFCC and download the ZIP from WebDAV.

#### list-sites
```bash
node src/main.js list-sites
```
List all sites and export cartridge paths to CSV.

### Work-in-Progress Commands

#### validate-cartridges-all
```bash
node src/main.js validate-cartridges-all
```
[WIP] Validate cartridges across ALL configured realms in parallel.

#### validate-site-xml
```bash
node src/main.js validate-site-xml
```
[WIP] Validate that site.xml files match live SFCC cartridge paths.
