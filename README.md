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

### Step 3: Import Backup Job on Your Environment

The `remove-preferences` and `backup-site-preferences` commands trigger a server-side backup job before deleting any preferences. This job must exist on each SFCC instance you intend to run the script against.

**Steps:**

1. In **Business Manager**, go to **Administration** → **Site Development** → **Import & Export**
2. Upload the job definition file located at [`src/config/jobs-import-SFCC-413.xml`](src/config/jobs-import-SFCC-413.xml)
3. Select **Import** and choose the uploaded file
4. Confirm the import — this creates a job called **`site preferences - BACKUP`**
5. Verify the job exists under **Administration** → **Operations** → **Jobs**

> **Note:** The job ID (`site preferences - BACKUP`) must match the `backup.jobId` value in your `config.json`. If you rename the job, update the config to match.

> **Repeat for each environment** — the job must be imported on every realm/instance where you plan to run `remove-preferences` or `backup-site-preferences`.

---

### Step 4: Add Realm Configuration

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

Removes preferences marked for deletion. Supports two **deletion sources**:
- **Per-realm files** (default) — each realm has its own deletion candidates, tiers re-classified per-realm
- **Cross-realm intersection** — only preferences at the same tier on ALL realms, applied uniformly to all selected realms

```bash
node src/main.js remove-preferences
node src/main.js remove-preferences --dry-run  # simulate without changes
```

**Deletion Level Selection:**

Before loading files, you choose a **deletion level** (cascading tiers):

| Level | Includes | Description |
|---|---|---|
| **P1** | P1 only | Safest — no code, no values |
| **P2** | P1 + P2 | No code references anywhere |
| **P3** | P1–P3 | Adds deprecated-code-only prefs |
| **P4** | P1–P4 | Adds deprecated code + values |
| **P5** | P1–P5 | Everything including realm-specific |

**Deletion Source Selection:**

After choosing the tier level, you choose which file to load:

| Source | Description |
|---|---|
| **Per-realm files** | Each realm loads its own `{realm}_preferences_for_deletion.txt` |
| **Cross-realm intersection** | Loads `{instance}_cross_realm_deletion_candidates.txt` and applies the same list to all selected realms. Only includes preferences at the same tier on ALL realms — safest for bulk deletion. |

**Flow:** Select instance → Select realms → Select deletion level → Select deletion source → Load files → Review in VS Code → Create backups → Confirm → Delete

---

### 3. **restore-preferences** - Roll Back Deletions

Restore previously deleted preferences from backup JSON files.

```bash
node src/main.js restore-preferences
```

---

For complete interactive prompts, output files, and config requirements for each command, see [COMMANDS.md](COMMANDS.md).

---

## Meta File Cleanup

After removing preferences via OCAPI, you also need to remove their XML definitions from the sibling SFCC repository's meta files — otherwise, redeployment would recreate them.

### 4. **test-meta-cleanup** — Preview Changes

Dry-run by default. Scans meta XML files in the sibling repo and shows what would be removed.

```bash
node src/main.js test-meta-cleanup              # preview only (default)
node src/main.js test-meta-cleanup --execute     # actually modify files
```

**What it does:**
1. Select sibling SFCC repository & realms
2. Load deletion candidates (per-realm or cross-realm intersection)
3. Build a cleanup plan (attribute definitions, group assignments, preference values)
4. Show the plan — optionally execute
5. Run residual scan to catch any remaining references

### 5. **meta-cleanup** — Full Git Workflow

End-to-end: creates a branch, removes definitions, cleans up preference values, optionally consolidates to single meta file, stages and commits.

```bash
node src/main.js meta-cleanup
```

**Workflow:**
1. Select sibling repo, check for uncommitted changes
2. Select base branch (e.g., `develop`)
3. Select realms, deletion tier (P1–P5), and source (per-realm or cross-realm)
4. Create a new branch (e.g., `chore/cleanup-P2-development-2026-03-06`)
5. Build and execute cleanup plan
6. Remove orphaned `<preference preference-id="X">` entries from `preferences.xml` files
7. Optional: consolidate to single meta file per realm (triggers BM backup job)
8. Stage all changes and commit with descriptive message + full attribute list

**Commit output includes:**
- Subject: `chore: remove N unused site preference definition(s) — P2 development`
- Body: source type, tier level + description, and list of all removed attribute IDs

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
├── APAC_meta_data_backup_2026-03-05.xml
├── EU05_meta_data_backup_2026-03-05.xml
├── GB_meta_data_backup_2026-03-05.xml
├── PNA_meta_data_backup_2026-03-05.xml
└── archive/
    └── *_meta_data_backup_*.xml    (auto-archived on refresh)
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
│   │   ├── development_preferences_for_deletion.txt  ← UNIFIED DELETION LIST
│   │   ├── development_combined_realm_deletion_candidates.txt  ← ALL REALMS IN ONE FILE
│   │   ├── development_cross_realm_deletion_candidates.txt     ← CROSS-REALM INTERSECTION
│   │   └── development_unused_preferences.txt
│   ├── APAC/
│   │   ├── APAC_active_site_cartridges_list.csv
│   │   ├── APAC_development_preferences_matrix.csv
│   │   ├── APAC_development_preferences_usage.csv
│   │   ├── APAC_preferences_for_deletion.txt         ← PER-REALM DELETION LIST
│   │   ├── APAC_unused_preferences.txt
│   │   └── APAC_used_preferences.txt
│   ├── EU05/
│   │   ├── EU05_preferences_for_deletion.txt         ← PER-REALM DELETION LIST
│   │   └── ...
│   └── ...
├── sandbox/
│   ├── ALL_REALMS/
│   │   └── sandbox_preferences_for_deletion.txt
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
- `{instance}_preferences_for_deletion.txt` - Unified deletion list (all realms, with realm tags)
- `{instance}_combined_realm_deletion_candidates.txt` - All realms' candidates in one file, grouped by realm
- `{instance}_cross_realm_deletion_candidates.txt` - **Cross-realm intersection** (same tier on ALL realms, usable by `remove-preferences`)
- `{realm}_preferences_for_deletion.txt` - **Per-realm deletion list** (used by `remove-preferences`)

**Per-realm vs. unified deletion files:**

The unified file in `ALL_REALMS/` shows all candidates with realm tags (e.g., `[EU05, APAC]`). The per-realm files in each realm folder contain only the preferences that exist on that specific realm, with tiers re-classified using realm-specific value data. For example, a P2 preference globally (has values somewhere) may be P1 on a realm where it has no values.

Each realm creates its own folder within `results/`, organized by instance type.

---

## Whitelist & Blacklist System

The tool uses two filter lists to control which preferences can be deleted. Both are applied when the deletion file is loaded by `remove-preferences`.

- **Blacklist** (`src/config/preference_blacklist.json`) — Preferences that can **never** be deleted (e.g., payment integrations)
- **Whitelist** (`src/config/preference_whitelist.json`) — When non-empty, **only** matching preferences are eligible for deletion

**Filter order:** `Per-Realm File → [Tier Filter] → [Whitelist: keep matches] → [Blacklist: remove matches] → Eligible`

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
- Run `node src/main.js check-api-endpoints` to see exactly which permissions are missing
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

### Diagnose API Permission Issues

If any command fails with `403 Forbidden` or you're unsure which OCAPI permissions are configured, run the endpoint health check:

```bash
# Check all realms at once
node src/main.js check-api-endpoints

# Check a single realm
node src/main.js check-api-endpoints -r EU05
```

This probes all 21 OCAPI endpoints used by the tool (without modifying any data) and reports:
- Whether OAuth authentication works for each realm
- Which endpoints are accessible and which return `403 Forbidden`
- Exact action items telling you which resource and method to add in Business Manager

See [COMMANDS.md — check-api-endpoints](COMMANDS.md#check-api-endpoints) for full details.

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
analyzer.js / summarize.js (aggregates data, generates matrices)
    ↓
CSV outputs (matrix, usage)
    ↓
codeScanner.js (scans cartridges for references)
    ↓
Text outputs (unused, cartridge mapping, per-realm deletion lists)
    ↓
[Optional] meta-cleanup (removes from sibling repo XML + git commit)
```

### Key Files

- **[src/main.js](src/main.js)** - CLI entry point, command registration
- **[src/api/api.js](src/api/api.js)** - OCAPI client, all SFCC communication
- **[src/helpers/summarize.js](src/helpers/summarize.js)** - Data aggregation and matrix building
- **[src/helpers/analyzer.js](src/helpers/analyzer.js)** - Matrix processing orchestration
- **[src/io/codeScanner.js](src/io/codeScanner.js)** - Cartridge code scanning & deletion candidates
- **[src/io/csv.js](src/io/csv.js)** - CSV read/write
- **[src/commands/preferences/preferences.js](src/commands/preferences/preferences.js)** - Remove/restore commands
- **[src/commands/meta/meta.js](src/commands/meta/meta.js)** - Meta cleanup commands
- **[src/commands/meta/helpers/metaFileCleanup.js](src/commands/meta/helpers/metaFileCleanup.js)** - Meta XML manipulation
- **[src/commands/meta/helpers/gitHelper.js](src/commands/meta/helpers/gitHelper.js)** - Git operations for sibling repo
- **[src/commands/meta/helpers/metaConsolidation.js](src/commands/meta/helpers/metaConsolidation.js)** - Single-file meta consolidation
- **[src/config/constants.js](src/config/constants.js)** - Application constants (tiers, patterns, log prefixes)
- **[src/config/helpers/helpers.js](src/config/helpers/helpers.js)** - Config read/write, realm management
- **[config.json](config.json)** - Realm configuration (credentials)
- **[src/config/ocapi_config.json](src/config/ocapi_config.json)** - OCAPI resource definitions

---

## Support

For issues or questions:

1. **Check Troubleshooting section** above
2. **Review output files** in `results/` and `backup/` directories
3. **Check SFCC instance status** - OCAPI might be temporarily down
4. **Review logs** - enable debug mode to see detailed errors

