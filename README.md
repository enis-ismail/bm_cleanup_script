# Cleanup Script - OCAPI Tools

Tools for working with Salesforce Commerce Cloud (SFCC) OCAPI to analyze and manage site preferences and attribute groups.

## Quick Start (5 Minutes)

**Prerequisites:**
1. API Client credentials (see [Setup](#complete-setup-guide) below)
2. OCAPI endpoints configured in Business Manager
3. Node.js v14+ installed

**Fast Track:**
```bash
# 1. Add your realm to config
node src/main.js add-realm
# (Enter: realm name, hostname, clientId, clientSecret)

# 2. Analyze preferences (15-30 min depending on realm size)
node src/main.js analyze-preferences
# (Select realm → repository → review deletion list in VS Code)

# 3. Remove preferences (5 min)
node src/main.js remove-preferences
# (Select realm → confirm → done!)
```

---

## Prerequisites

- **Node.js** (v14 or higher)
- **npm** (comes with Node.js)
- **VS Code** (recommended, for reviewing deletion list)
- **SFCC Account Access** to obtain API credentials and configure Business Manager

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:
```bash
npm install
```

---

## Complete Setup Guide

### Step 1: Obtain API Client Credentials

You need OAuth credentials for each realm/sandbox you want to analyze.

**How to get Client ID and Client Secret:**

1. Log in to your **Salesforce Commerce Cloud Account Manager**
2. Navigate to **Account** → **API Clients** (or **API Client** section)
3. If you have an existing client:
   - Note the **API Client ID** (this is your `clientId`)
   - Copy the **Client Secret** (keep this secure!)
4. If you DON'T have an API client:
   - Create a new API client in Account Manager
   - Give it a descriptive name (e.g., "Preference-Cleanup")
   - Save and copy the credentials

**⚠️ Security Note:** Never commit `config.json` containing real credentials to version control.

---

### Step 2: Configure OCAPI Endpoints in Business Manager

Before running the analysis, you must add OCAPI resource permissions to your API client.

**Steps:**

1. Log in to **Business Manager** (https://your-instance.salesforceecommerce.com/on/demandware.admin/default/home)
2. Navigate to **Administration** → **Open Commerce API (OCAPI)** → **Data API**
3. In the **Data** section, find or create your client configuration
4. Add the required resources from the table below
5. Save the configuration

**Required OCAPI Endpoints:**

Copy the `resources` array from [ocapi_config.json](ocapi_config.json) and add to your Business Manager configuration. These are the minimum required:

| Resource ID | Methods | Purpose |
|---|---|---|
| `/sites` | GET | List all sites |
| `/sites/*` | GET | Get site details |
| `/system_object_definitions/*` | GET | Get object definitions (SitePreferences, etc.) |
| `/system_object_definitions/*/attribute_definitions` | GET | List all attribute definitions |
| `/system_object_definitions/*/attribute_definitions/*` | GET, DELETE, PUT, PATCH | Read/write individual attributes |
| `/system_object_definitions/*/attribute_groups` | GET | List attribute groups |
| `/system_object_definitions/*/attribute_groups/*` | GET | Get group details |
| `/sites/*/site_preferences/preference_groups/*/*` | GET, PATCH | Read/write site preferences |

**Attribute Permissions:**
- Set `read_attributes` to `(**)` (read all attributes)
- Set `write_attributes` to `(**)` (write all attributes)

**Location in Business Manager UI:**
```
Administration
  → Open Commerce API Settings
    → Data API
      → Client Applications
        → [Your Client]
          → Resources (add here)
```

---

### Step 3: Add Realm Configuration

Once you have credentials, add them to the script via CLI (recommended) or manually.

**Option 1: Using CLI (Recommended)**

```bash
node src/main.js add-realm
```

When prompted, enter:
- **Realm** (e.g., `bcwr-080`, `my-staging`) - friendly name for your sandbox
- **Hostname** (e.g., `bcwr-080.dx.commercecloud.salesforce.com`) - your SFCC instance hostname
- **Client ID** - from Step 1
- **Client Secret** - from Step 1

**Option 2: Manual Configuration**

Edit `config.json` directly:

```json
{
  "realms": [
    {
      "name": "bcwr-080",
      "hostname": "bcwr-080.dx.commercecloud.salesforce.com",
      "clientId": "your-api-client-id-here",
      "clientSecret": "your-api-client-secret-here"
    },
    {
      "name": "staging-realm",
      "hostname": "staging-realm.dx.commercecloud.salesforce.com",
      "clientId": "staging-client-id",
      "clientSecret": "staging-client-secret"
    }
  ]
}
```

**Start with Template:**
```bash
cp config.example.json config.json
```
Then edit `config.json` with real credentials.

---

## Core Workflow: Analyze & Remove Preferences

The main workflow consists of two commands:

### 1. **analyze-preferences** - Find Unused Preferences

This command analyzes site preferences across realms to identify which ones are safe to delete.

**What it does:**
1. Fetches all sites and preference groups from SFCC OCAPI
2. Retrieves preference values for each site
3. Automatically scans your cartridge code for preference references
4. Identifies preferences with:
   - No values in any site
   - No default values defined
   - No references in active cartridge code
5. Generates a **deletion candidate list**

**How to run:**
```bash
node src/main.js analyze-preferences
```

**Interactive prompts:**
```
STEP 1: Configure Scope & Options
  → Select sibling repository (cartridge folder to analyze)
  → Choose realm(s): single, by instance type, or ALL realms
  → Object type (default: SitePreferences)
  → Scope: ALL_SITES or specific site ID
  → Include default values? (Y/N)
  → Reuse existing backups if <14 days old? (Y/N)

STEP 2: Fetching & Summarizing Preferences
  (Runs in background, shows progress)

STEP 3: Checking Preference Usage
  (Processes matrix files, shows statistics)

STEP 4: Active Preferences Summary
  (Lists all preferences found across realms)

STEP 5: Finding Preference Usage in Cartridges
  (Scans code for references, generates cartridge mapping)

STEP 6: Create Backups (Optional)
  → Create backup files? (Y/N, default: yes)
  → Refresh metadata from SFCC? (Y/N, default: no)
  (Creates backup JSON for each realm with all preference definitions)
```

**Output files created:**

Organized in `results/{instanceType}/`:

| File | Purpose |
|---|---|
| `{instance}_preferences_for_deletion.txt` | **MAIN OUTPUT** - Safe-to-delete preferences |
| `{instance}_unused_preferences.txt` | Preferences with no values |
| `{instance}_cartridge_preferences.txt` | Preference → Cartridge mapping |
| `{instance}_preference_usage.txt` | Summary statistics |
| `{realm}_preferences_matrix.csv` | Matrix of site × preference usage |
| `{realm}_preferences_usage.csv` | Actual preference values per site |

**Deletion logic:**

A preference is marked for deletion if:
- ✓ No site has a value (matrix is empty)
- ✓ No default value exists in attribute definitions
- ✓ Not referenced in any active cartridge code
- ✓ OR only referenced in deprecated/removed cartridges

---

### 2. **remove-preferences** - Delete Selected Preferences

This command removes preferences that were marked for deletion from Step 1.

**What it does:**
1. Loads the deletion list from `analyze-preferences` output
2. Creates backups per realm (rollback capability)
3. Removes preference definitions from SFCC OCAPI
4. Optionally restores from backups if needed

**How to run:**
```bash
node src/main.js remove-preferences
```

**Interactive prompts:**
```
STEP 1: Select Instance Type
  → Choose: development, staging, production

STEP 2: Load Preferences for Deletion
  → Loads {instance}_preferences_for_deletion.txt
  → If missing, offers to run analyze-preferences
  (If run, will take 15-30 min depending on realm size)

STEP 3: Review Preferences for Deletion
  → Opens deletion list in VS Code
  → Shows summary: total count, top prefixes
  (Review and manually edit list if needed)

STEP 4: Select Realms to Process
  → Choose which realms to remove from (can select multiple)
  → Default: all configured realms

STEP 5: Create Backups (Per Realm)
  Status check:
  - Shows which realms already have today's backup
  - Offers to create new backups for all or skip existing
  
  For realms needing backup:
  → Download metadata XML from SFCC? (Y/N, default: no)
  → Creates JSON backup with all definitions
  → Shows: total attributes, groups, site values

STEP 6: Confirm Deletion
  → Shows backup summary
  → Final confirmation needed before deletion

STEP 7: Remove Preferences
  → Deletes each preference from SFCC OCAPI
  → Shows success/failure per preference per realm
  → Creates deletion summary report

STEP 8: Restore from Backups (Optional)
  → If deletion failed, can restore from backup
  → Confirms restore before proceeding
```

**Output created:**

Backup files in `backup/{instanceType}/`:
```
{realm}_SitePreferences_backup_2026-02-18.json
```

---

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

**Step 2:** Review preferences
- Opens deletion file in VS Code for manual review
- Shows summary (total count, top prefixes being removed)

**Step 3:** Select realms to process
- Choose which realms to create backups for
- Can select multiple realms at once

**Step 4:** Create backups (per realm)
- Downloads metadata XML from SFCC (if not already fresh)
- Extracts attribute definitions directly from metadata
- Creates backup JSON file with all definitions
- Adds attribute group assignments from metadata
- **No OCAPI fetching** - uses offline metadata parsing
- Backups created BEFORE deletion confirmation

**Step 5:** Confirm deletion
- Reviews backup summary
- Final confirmation AFTER backups are ready
- Can cancel without deleting (backups preserved)

**Step 6:** Remove preferences (⚠️ NOT YET IMPLEMENTED)
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

#### restore-preferences
```bash
node src/main.js restore-preferences
```
Restore deleted preferences from backup files. Useful if deletion went wrong.

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

---

## Troubleshooting

### Common Issues

#### "No realms found in config"
**Problem:** You haven't added any realms yet.

**Solution:**
```bash
node src/main.js add-realm
```
Follow the prompts to add your first realm.

---

#### "401 Unauthorized" or "Invalid credentials"

**Problem:** API client credentials are incorrect or OCAPI permissions are missing.

**Checklist:**
1. Verify Client ID and Secret are correct in `config.json`
2. Confirm credentials in [Account Manager](https://account.salesforce.com/)
3. Check Business Manager OCAPI configuration:
   - Go to **Administration** → **Open Commerce API Settings** → **Data API**
   - Verify your client has the required resources
   - Ensure read/write attributes are set to `(**)`
4. Restart your sandbox if OCAPI settings were just changed

**Solution:**
- Update credentials: `node src/main.js remove-realm` then `add-realm` again
- Or manually edit `config.json` and verify formatting

---

#### "Preferences for deletion file not found"

**Problem:** You tried `remove-preferences` but `analyze-preferences` hasn't been run yet.

**Solution:**
The script will offer to run `analyze-preferences` automatically. Let it run (takes 15-30 minutes depending on realm size).

Or run manually first:
```bash
node src/main.js analyze-preferences
```

---

#### "Cannot find repository" or "Cartridge scan failed"

**Problem:** The script can't find your cartridge folder or sibling repositories.

**Solution:**
1. Make sure you're running from the Cleanup-Script directory:
   ```bash
   cd path/to/Cleanup-Script
   ```
2. Ensure your repo structure matches expected layout:
   ```
   parent-folder/
   ├── Cleanup-Script/  (where you run commands from)
   ├── your-repo/       (sibling repo with cartridges)
   │   └── cartridges/
   │       ├── app_storefront_base/
   │       ├── int_*
   │       └── ...
   ```
3. When prompted for repository, select from the list shown

---

#### "Timeout" or "API rate limit exceeded"

**Problem:** Script got rate-limited by SFCC OCAPI.

**Solution:**
The script has built-in rate limiting, but if it still fails:
1. Try again in 5 minutes
2. Run with fewer realms at once
3. Check SFCC system status

---

#### "Backup file already exists" error

**Problem:** Backup for today already exists.

**Solution (in remove-preferences):**
When prompted "Create new ones anyway?":
- Answer **YES** to overwrite with fresh data
- Answer **NO** to reuse existing backup (faster)

---

### Debug Mode

To see detailed logs and debug information:

```bash
# Set debug environment variable
set DEBUG=* && node src/main.js analyze-preferences
```

This will show:
- API request/response details
- File paths being processed
- Detailed error messages

---

## Performance Tips

### For Large Realms (1000+ sites)

**analyze-preferences is slow:**
- First run will take 15-30 minutes (OCAPI calls are naturally slow)
- Subsequent runs: answer YES to "reuse existing backups <14 days" to skip re-fetching

**Cartridge scanning is slow:**
- Only happens once per analysis
- Results are cached until you run analyze-preferences again
- If your repo has many cartridges (100+), expect 5-10 minutes

### For remove-preferences

**Run once and verify before re-running:**
- If deletion succeeds, don't run again (preferences are gone)
- If deletion fails, use restore-preferences to recover from backup
- Don't repeat same realm on same day (wastes backup space)

---

## Architecture

### Data Flow

```
OCAPI (SFCC Cloud)
    ↓
api.js (OAuth authenticated requests)
    ↓
preferenceHelper.js (aggregates data, generates matrices)
    ↓
CSV outputs (matrix, usage)
    ↓
preferenceUsage.js (scans cartridges for references)
    ↓
Text outputs (unused, cartridge mapping, deletion list)
```

### Key Files

- **[src/api.js](src/api.js)** - OCAPI client, all SFCC communication
- **[src/main.js](src/main.js)** - CLI commands, user interaction
- **[src/helpers/preferenceHelper.js](src/helpers/preferenceHelper.js)** - Data aggregation and CSV generation
- **[src/helpers/preferenceUsage.js](src/helpers/preferenceUsage.js)** - Cartridge code scanning
- **[src/helpers/generateSitePreferencesJSON.js](src/helpers/generateSitePreferencesJSON.js)** - Backup file generation
- **[src/helpers/backupJob.js](src/helpers/backupJob.js)** - SFCC backup job triggering
- **[config.json](config.json)** - Realm configuration (credentials)
- **[ocapi_config.json](ocapi_config.json)** - OCAPI resource definitions

---

## Support

For issues or questions:

1. **Check Troubleshooting section** above
2. **Review output files** in `results/` and `backup/` directories
3. **Check SFCC instance status** - OCAPI might be temporarily down
4. **Review logs** - enable debug mode to see detailed errors

