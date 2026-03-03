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

- **Node.js** (v16 or higher)
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

Copy the `resources` array from [src/config/ocapi_config.json](src/config/ocapi_config.json) and add to your Business Manager configuration. These are the minimum required:

| Resource ID | Methods | Purpose |
|---|---|---|
| `/sites` | GET | List all sites |
| `/sites/*` | GET | Get site details |
| `/system_object_definitions/*` | GET | Get object definitions (SitePreferences, etc.) |
| `/system_object_definitions/*/attribute_definitions` | GET | List all attribute definitions |
| `/system_object_definitions/*/attribute_definitions/*` | GET, PUT, POST, PATCH, DELETE | Read/write/delete individual attributes |
| `/system_object_definitions/*/attribute_groups` | GET | List attribute groups |
| `/system_object_definitions/*/attribute_groups/*` | GET | Get group details |
| `/system_object_definitions/*/attribute_groups/*/attribute_definitions/*` | GET, PUT, POST, DELETE | Assign/remove attributes in groups |
| `/sites/*/site_preferences/preference_groups/*/*` | GET, PATCH | Read/write site preferences |
| `/site_preferences/preference_groups/*/*/preference_search` | POST | Search preferences in a group |
| `/jobs/*/executions` | POST, GET | Trigger and list backup jobs |
| `/jobs/*/executions/*` | GET | Poll backup job status |

> **Note:** `POST` is required alongside `PUT` because SFCC blocks direct PUT on non-sandbox instances. The tool uses the OCAPI method override pattern (`POST` + `x-dw-http-method-override: PUT`) for write operations.

**Technical Endpoint Reference:**

For developers implementing additional integrations, here are the exact API calls made by this tool:

**Authentication:**
- `POST https://account.demandware.com/dwsso/oauth2/access_token` (obtain OAuth bearer token)

**analyze-preferences Command:**
1. `GET https://{hostname}/s/-/dw/data/v19_5/sites` (list all sites)
2. `GET https://{hostname}/s/-/dw/data/v19_5/sites/{siteId}` (get site details)
3. `GET https://{hostname}/s/-/dw/data/v19_5/system_object_definitions/SitePreferences/attribute_definitions` (paginated: `?start=0&count=200`)
4. `GET https://{hostname}/s/-/dw/data/v25_6/system_object_definitions/SitePreferences/attribute_definitions/{id}` (individual attrs for defaults)
5. `GET https://{hostname}/s/-/dw/data/v25_6/system_object_definitions/SitePreferences/attribute_groups`
6. `GET https://{hostname}/s/-/dw/data/v25_6/system_object_definitions/SitePreferences/attribute_groups/{groupId}/attribute_definitions/*`
7. `GET https://{hostname}/s/-/dw/data/v25_6/sites/{siteId}/site_preferences/preference_groups/{groupId}/{instanceType}` (per site × group)

**remove-preferences Command (extends analyze-preferences):**
8. `POST https://{hostname}/s/-/dw/job/v24_5/jobs/{jobId}/executions` (trigger backup job)
9. `GET https://{hostname}/s/-/dw/job/v24_5/jobs/{jobId}/executions/{executionId}` (poll status)
10. WebDAV download: `GET https://{webdavUrl}/{path}` (download metadata XML backup)
11. `DELETE https://{hostname}/s/-/dw/data/v25_6/system_object_definitions/SitePreferences/attribute_definitions/{preferenceId}` (delete preferences)

**restore-preferences Command (optional restore from backup):**
12. `PUT https://{hostname}/s/-/dw/data/v25_6/system_object_definitions/SitePreferences/attribute_definitions/{preferenceId}` (restore attribute definition)
13. `PUT https://{hostname}/s/-/dw/data/v25_6/system_object_definitions/SitePreferences/attribute_groups/{groupId}/attribute_definitions/{preferenceId}` (assign to group)
14. `PATCH https://{hostname}/s/-/dw/data/v25_6/sites/{siteId}/site_preferences/preference_groups/{groupId}/{instanceType}` (restore site values)

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

**OCAPI Resources JSON for Business Manager:**

Copy the `resources` array from [src/config/ocapi_config.json](src/config/ocapi_config.json) into your Business Manager OCAPI Data API configuration. This is the single source of truth for all required endpoints.

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

The main workflow consists of two commands. For the full command reference with all options, config requirements, and step-by-step details, see [COMMANDS.md](COMMANDS.md).

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
5. Generates a **deletion candidate list** with priority tiers (P1–P5)

```bash
node src/main.js analyze-preferences
```

**Deletion priority tiers:**

| Tier | Label | Criteria |
|---|---|---|
| **P1** | Safe to Delete | No code references, no values, no defaults |
| **P2** | Likely Safe | No code references, but has values or defaults |
| **P3** | Review: Deprecated Only | Only referenced in deprecated cartridges, no values |
| **P4** | Review: Deprecated + Values | Only referenced in deprecated cartridges, has values |
| **P5** | Realm-Specific Code | Active code in some realms only |

The analyzer also detects **dynamic value references** — preferences whose IDs are stored as values of other preferences — and handles them automatically (see [COMMANDS.md — analyze-preferences](COMMANDS.md#2-analyze-preferences) for details).

---

### 2. **remove-preferences** - Delete Selected Preferences

Removes preferences marked for deletion. Creates backups before any deletion.

```bash
node src/main.js remove-preferences
node src/main.js remove-preferences --dry-run  # simulate without changes
```

**Flow:** Load deletion list → Review in VS Code → Select realms → Create backups → Confirm → Delete

---

### 3. **restore-preferences** - Roll Back Deletions

Restore previously deleted preferences from backup JSON files.

```bash
node src/main.js restore-preferences
```

---

For complete interactive prompts, output files, and config requirements for each command, see [COMMANDS.md](COMMANDS.md).

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

---

## Whitelist & Blacklist System

The tool uses two filter lists to control which preferences can be deleted. Both are applied when the deletion file is loaded by `remove-preferences`.

- **Blacklist** (`src/config/preference_blacklist.json`) — Preferences that can **never** be deleted (e.g., payment integrations)
- **Whitelist** (`src/config/preference_whitelist.json`) — When non-empty, **only** matching preferences are eligible for deletion

**Filter order:** `Deletion File → [Whitelist: keep matches] → [Blacklist: remove matches] → Eligible`

**CLI Commands:**
```bash
node src/main.js list-blacklist           # View blacklisted patterns
node src/main.js add-to-blacklist         # Add a pattern
node src/main.js remove-from-blacklist    # Remove a pattern

node src/main.js list-whitelist           # View whitelisted patterns
node src/main.js add-to-whitelist         # Add a pattern
node src/main.js remove-from-whitelist    # Remove a pattern
```

For pattern types (exact, wildcard, regex), evaluation details, and typical workflows, see [COMMANDS.md — Setup Commands](COMMANDS.md#1-setup-commands).

---

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

### Parallel File Scanning

Cartridge code scanning uses **parallel async I/O** with [`p-limit`](https://www.npmjs.com/package/p-limit) for significantly faster file reads:

- **Concurrency:** 50 concurrent file reads (configurable via `FILE_SCAN_CONCURRENCY` in `src/io/codeScanner.js`)
- **Thread pool:** `UV_THREADPOOL_SIZE` is set to 64 at startup (default Node.js is 4), allowing the libuv thread pool to keep up with parallel reads
- **Impact:** File scanning that previously ran sequentially now saturates disk I/O, reducing scan times on SSD by 3-5x

The thread pool size is set automatically in `src/main.js` before any imports. No manual `set UV_THREADPOOL_SIZE=64` is needed.

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

- **[src/main.js](src/main.js)** - CLI commands, user interaction
- **[src/api.js](src/api.js)** - OCAPI client, all SFCC communication
- **[src/helpers/preferenceHelper.js](src/helpers/preferenceHelper.js)** - Data aggregation and CSV generation
- **[src/helpers/preferenceUsage.js](src/helpers/preferenceUsage.js)** - Cartridge code scanning
- **[src/helpers/preferenceBackup.js](src/helpers/preferenceBackup.js)** - Backup file generation
- **[src/helpers/backupJob.js](src/helpers/backupJob.js)** - SFCC backup job triggering
- **[config.json](config.json)** - Realm configuration (credentials)
- **[src/config/ocapi_config.json](src/config/ocapi_config.json)** - OCAPI resource definitions

---

## Support

For issues or questions:

1. **Check Troubleshooting section** above
2. **Review output files** in `results/` and `backup/` directories
3. **Check SFCC instance status** - OCAPI might be temporarily down
4. **Review logs** - enable debug mode to see detailed errors

