# CLI Commands Reference

Complete reference for all available commands. For the main workflow overview, see [README.md](README.md).

## All Commands

| Command | Category | Description |
|---|---|---|
| `add-realm` | Setup | Add a new realm to config.json |
| `remove-realm` | Setup | Remove a realm from config.json |
| `add-to-blacklist` | Setup | Add a preference pattern to the blacklist |
| `remove-from-blacklist` | Setup | Remove a preference pattern from the blacklist |
| `list-blacklist` | Setup | Show all blacklisted preference patterns |
| `add-to-whitelist` | Setup | Add a preference pattern to the whitelist |
| `remove-from-whitelist` | Setup | Remove a preference pattern from the whitelist |
| `list-whitelist` | Setup | Show all whitelisted preference patterns |
| `analyze-preferences` | Core | Full preference analysis workflow |
| `remove-preferences` | Core | Remove preferences marked for deletion |
| `restore-preferences` | Core | Restore site preferences from backup |
| `backup-site-preferences` | Core | Trigger backup job and download metadata |
| `list-sites` | Utility | List all sites and export cartridge paths to CSV |
| `validate-cartridges-all` | Utility (WIP) | Validate cartridges across all realms |
| `validate-site-xml` | Utility (WIP) | Validate site.xml vs live cartridge paths |
| `find-preference-usage` | Debug | Find cartridges using a specific preference ID |
| `list-attribute-groups` | Debug | List attribute groups for an object type |
| `get-attribute-group` | Debug | Get details of a specific attribute group |
| `test-active-preferences` | Debug | Display all active preferences from matrix files |
| `test-patch-attribute` | Debug | Test patching an attribute definition |
| `test-put-attribute` | Debug | Test replacing an attribute definition |
| `test-delete-attribute` | Debug | Test deleting an attribute definition |
| `test-set-site-preference` | Debug | Test setting a site preference value |
| `test-backup-restore-cycle` | Debug | Test full backup → delete → restore cycle |
| `find-attribute-group-in-meta` | Debug | Search for attribute group in meta.xml files |
| `test-generate-backup-json` | Debug | Generate backup JSON from deletion list |
| `test-concurrent-timers` | Debug | Test dynamic progress logging |
| `debug-progress` | Debug | Simulate progress display |

---

## Flow Order

The typical workflow follows this sequence:

```
1. Setup        →  add-realm, blacklist/whitelist config
2. Analyze      →  analyze-preferences
3. Remove       →  remove-preferences
4. Restore      →  restore-preferences (if needed)
5. Backup       →  backup-site-preferences (standalone)
6. Utilities    →  list-sites, validate-*
```

---

## 1. Setup Commands

These commands configure the tool before running any analysis or deletion.

### add-realm

```bash
node src/main.js add-realm
```

Add a new SFCC realm to the configuration. Realms represent SFCC instances (sandbox, development, staging, production) that you want to analyze.

**Required config:** None — this command *creates* the configuration.

**Interactive prompts:**
- **Realm name** — friendly identifier (e.g., `bcwr-080`, `EU05`)
- **Hostname** — SFCC instance hostname (e.g., `bcwr-080.dx.commercecloud.salesforce.com`)
- **Client ID** — OCAPI client ID from Account Manager
- **Client Secret** — OCAPI client secret

**What it does:**
1. Validates the hostname format
2. Tests the credentials by requesting an OAuth token
3. Saves the realm to `config.json`

**Config file:** `config.json`
```json
{
  "realms": [
    {
      "name": "bcwr-080",
      "hostname": "bcwr-080.dx.commercecloud.salesforce.com",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret"
    }
  ]
}
```

> **Prerequisite:** You need OCAPI endpoints configured in Business Manager before the credential test will succeed. See [README.md — Setup Guide](README.md#complete-setup-guide).

---

### remove-realm

```bash
node src/main.js remove-realm
```

Remove a realm from `config.json`.

**Required config:** At least one realm in `config.json`.

**Interactive prompts:**
- Select realm to remove from list
- Confirm removal

---

### add-to-blacklist

```bash
node src/main.js add-to-blacklist
```

Add a preference pattern to the blacklist. Blacklisted preferences are **protected from deletion** — they will be excluded from the deletion file during `analyze-preferences` and listed in a separate "Blacklisted Preferences (Protected)" section.

**Required config:** None.

**Interactive prompts:**
- **Pattern type** — `exact`, `wildcard`, or `regex`
- **Pattern/ID** — the pattern to match (e.g., `Adyen_*`, `c_myPref`)
- **Reason** — why this preference is protected

**Config file:** `src/config/preference_blacklist.json`

**Pattern types:**

| Type | Example | Matches |
|---|---|---|
| `exact` | `c_myPref` | Only `c_myPref` |
| `wildcard` | `Adyen_*` | `Adyen_Enabled`, `Adyen_Mode`, etc. |
| `regex` | `^c_test` | `c_testMode`, `c_testFlag`, etc. |

---

### remove-from-blacklist

```bash
node src/main.js remove-from-blacklist
```

Remove a pattern from the blacklist interactively.

**Required config:** At least one blacklist entry.

---

### list-blacklist

```bash
node src/main.js list-blacklist
```

Show all blacklisted preference patterns, their types, and reasons.

**Required config:** None.

---

### add-to-whitelist

```bash
node src/main.js add-to-whitelist
```

Add a preference pattern to the whitelist. When the whitelist is non-empty, **only matching preferences** are eligible for deletion during `remove-preferences`. All others are skipped.

**Required config:** None.

**Use case:** Target a specific batch for testing before doing a full deletion run.

**Interactive prompts:** Same as `add-to-blacklist` (type, pattern, reason).

**Config file:** `src/config/preference_whitelist.json`

---

### remove-from-whitelist

```bash
node src/main.js remove-from-whitelist
```

Remove a pattern from the whitelist interactively.

---

### list-whitelist

```bash
node src/main.js list-whitelist
```

Show all whitelisted preference patterns.

---

### Filter Evaluation Order

When `remove-preferences` loads per-realm deletion files, filters are applied in this order:

```
Per-Realm File → [Tier Filter: keep ≤ maxTier] → [Whitelist: keep matches only] → [Blacklist: remove matches] → Eligible
```

- **Tier filter:** Cascading — selecting P2 includes P1 + P2 sections only
- If the whitelist is **empty**, all preferences pass through (only blacklist applies)
- If the whitelist is **non-empty**, only matching IDs are kept
- Blacklist always removes matching IDs, regardless of whitelist

---

## 2. analyze-preferences

```bash
node src/main.js analyze-preferences
```

The main analysis command. Fetches preference data from SFCC, scans cartridge code, and generates a priority-ranked deletion candidate list.

**Required config:**
- At least one realm in `config.json` with valid credentials
- OCAPI endpoints configured in Business Manager (see [README.md — Setup Guide](README.md#step-2-configure-ocapi-endpoints-in-business-manager))
- A sibling repository with cartridges to scan (e.g., `../your-sfcc-repo/cartridges/`)

**Options:** None (all configuration is done via interactive prompts).

**Interactive prompts:**

```
STEP 1: Configure Scope & Options
  → Select sibling repository (cartridge folder to analyze)
  → Choose realm(s): single, by instance type, or ALL realms
  → Object type (default: SitePreferences)
  → Scope: ALL_SITES or specific site ID
  → Include default values? (Y/N)
  → Reuse existing backups if <14 days old? (Y/N)
```

**What it does (steps 2–6):**

| Step | Action | Duration |
|---|---|---|
| **STEP 2** | Fetch all sites, attribute groups, and preference values from SFCC via OCAPI | 5–20 min |
| **STEP 3** | Process matrix files, count preferences per realm | seconds |
| **STEP 4** | Summarize active preferences across all realms | seconds |
| **STEP 5** | Run `list-sites` logic per realm to refresh active site cartridge CSVs | 1–3 min |
| **STEP 6** | Scan cartridge code for preference references (parallel I/O) | 1–10 min |

**Output files created:**

Organized in `results/{instanceType}/`:

| File | Location | Purpose |
|---|---|---|
| `{instance}_preferences_for_deletion.txt` | `ALL_REALMS/` | Unified deletion list with realm tags |
| `{instance}_combined_realm_deletion_candidates.txt` | `ALL_REALMS/` | All realms' candidates in one file, grouped by realm then tier |
| `{instance}_cross_realm_deletion_candidates.txt` | `ALL_REALMS/` | **Cross-realm intersection** — only prefs at the same tier on ALL realms |
| `{instance}_unused_preferences.txt` | `ALL_REALMS/` | Preferences with no cartridge code references |
| `{instance}_cartridge_preferences.txt` | `ALL_REALMS/` | Preference → cartridge mapping |
| `{instance}_preference_usage.txt` | `ALL_REALMS/` | Summary statistics |
| `{realm}_preferences_for_deletion.txt` | `{realm}/` | **Per-realm deletion list** (used by `remove-preferences`) |
| `{realm}_active_site_cartridges_list.csv` | `{realm}/` | Site → active cartridge path mapping |
| `{realm}_preferences_matrix.csv` | `{realm}/` | Per-realm matrix: site × preference ("X" marks) |
| `{realm}_preferences_usage.csv` | `{realm}/` | Per-realm: actual preference values per site |

**Per-realm deletion files:**

In addition to the unified file in `ALL_REALMS/`, each realm gets its own `{realm}_preferences_for_deletion.txt`. These per-realm files:
- Only contain preferences that exist on that specific realm (from matrix data)
- Re-classify tiers using realm-specific value data (e.g., a global P2 becomes P1 on a realm with no values)
- Exclude P5 candidates where active code runs on this realm
- Are used by `remove-preferences` to avoid 404 errors from trying to delete non-existent preferences

**Cross-realm files:**

Two additional files are generated in `ALL_REALMS/`:

- **Combined realm listing** (`{instance}_combined_realm_deletion_candidates.txt`) — All realms' candidates in a single file, grouped by realm then tier. Useful for reviewing what would be deleted on each realm without opening multiple files.
- **Cross-realm intersection** (`{instance}_cross_realm_deletion_candidates.txt`) — Only preferences classified at the **same** priority tier on **ALL** realms. These are the safest candidates for bulk deletion because the analysis is consistent across every realm. Can be used directly by `remove-preferences` as an alternative to per-realm files.

**Deletion priority tiers:**

| Tier | Label | Criteria |
|---|---|---|
| **P1** | Safe to Delete | No code references, no values, no defaults |
| **P2** | Likely Safe | No code references, but has values or defaults |
| **P3** | Review: Deprecated Only | Only referenced in deprecated cartridges, no values |
| **P4** | Review: Deprecated + Values | Only referenced in deprecated cartridges, has values |
| **P5** | Realm-Specific Code | Active code in some realms only — delete from non-covered realms |

**Dynamic value detection:**

Some preferences store the ID of another preference as their value, creating an indirect runtime reference:
```javascript
var attr = Site.current.getPreferenceValue('parentPref'); // value = "childPref"
product.custom[attr] = ...;  // uses childPref without it appearing in code
```

The analyzer detects these references by scanning usage CSVs:
- If the **parent** is in active code → child is **removed** from deletion list (indirectly used)
- If the **parent** is also a candidate → child **inherits** the parent's tier, annotated with `⚠ dynamic value of: <parent>`
- If the **parent** is missing from attribute definitions but exists in usage CSV → added as a P1/P2 candidate itself

**Blacklist integration:**

Preferences matching patterns in `src/config/preference_blacklist.json` are excluded from the deletion file and listed in a separate "Blacklisted Preferences (Protected)" section at the bottom.

---

## 3. remove-preferences

```bash
node src/main.js remove-preferences
node src/main.js remove-preferences --dry-run
```

Remove preferences marked for deletion by `analyze-preferences`. Supports two deletion sources:
- **Per-realm files** — each realm has its own deletion candidates (default)
- **Cross-realm intersection** — only preferences at the same tier on ALL realms, applied uniformly

**Required config:**
- At least one realm in `config.json`
- Deletion files generated by `analyze-preferences`

**Options:**

| Flag | Description |
|---|---|
| `--dry-run` | Simulate deletion without making any OCAPI calls |

**Interactive prompts:**

```
STEP 1: Select Instance Type
  → Choose: development, staging, production

STEP 2: Select Realms to Process
  → Choose which realms to remove from (multi-select)

STEP 3: Select Deletion Level
  → Choose tier (cascading):
     1) P1 — Safe to Delete (No Code, No Values)
     2) P2 — Likely Safe (No Code, Has Values) [includes P1]
     3) P3 — Deprecated Code Only (No Values) [includes P1-P2]
     4) P4 — Deprecated Code + Values [includes P1-P3]
     5) P5 — Realm-Specific Code [includes P1-P4]

STEP 4: Select Deletion Source
  → Choose which deletion file to use:
     1) Per-realm files — Each realm has its own deletion candidates
     2) Cross-realm intersection — Only prefs at the same tier on ALL realms

STEP 5: Load Deletion Lists
  → Per-realm: Loads {realm}_preferences_for_deletion.txt for each selected realm
  → Cross-realm: Loads {instance}_cross_realm_deletion_candidates.txt and
    applies the same list to all selected realms
  → Applies tier filter (cascading: P2 includes P1+P2)
  → Applies whitelist filter (if non-empty)
  → Applies blacklist filter
  → If files missing, offers to run analyze-preferences first

STEP 6: Review Deletion Files
  → Per-realm: Opens each realm's deletion file in VS Code
  → Cross-realm: Opens the cross-realm intersection file in VS Code
  → Shows per-realm breakdown (how many per realm)
  → Shows blacklist/whitelist reminders
  (Edit the files to remove preferences you want to keep)

STEP 7: Create Backups (Per Realm)
  → Shows which realms already have today's backup
  → For each realm: downloads metadata XML, creates backup JSON
  → Backups created BEFORE deletion confirmation

STEP 8: Confirm Deletion
  → Shows backup summary per realm
  → Final confirmation required

STEP 9: Remove Preferences
  → Calls OCAPI DELETE for each preference per realm
  → Each realm only deletes preferences from its file
  → Logs success/failure per preference

STEP 10: Optional Restore
  → Offers to restore from backup if needed
```

**Deletion level behavior:**

The deletion level controls which priority tiers are included, using **cascading selection**:

| Level | Includes | Risk Level |
|---|---|---|
| P1 | P1 only | Lowest — no code, no values anywhere |
| P2 | P1 + P2 | Low — no code references found |
| P3 | P1 + P2 + P3 | Medium — adds deprecated-code-only |
| P4 | P1 + P2 + P3 + P4 | Medium-High — adds deprecated + values |
| P5 | All tiers | Higher — includes realm-specific active code |

**Deletion source options:**

| Source | File Used | Behavior |
|---|---|---|
| Per-realm (default) | `{realm}_preferences_for_deletion.txt` | Each realm gets its own candidate list; tiers re-classified per-realm |
| Cross-realm intersection | `{instance}_cross_realm_deletion_candidates.txt` | Same preference list applied to all selected realms; only includes prefs at the same tier on ALL realms |

**Per-realm file strategy:**

Each realm's deletion file contains only preferences that exist on that realm (based on matrix data). Tiers are re-classified per-realm:
- A **global P2** (has values somewhere) becomes **P1 on a realm with no values** and **P2 on a realm with values**
- **P5 candidates** only appear in a realm's file if the active code does NOT run on that realm
- This eliminates 404 errors during deletion (never tries to delete a preference that doesn't exist)

**Cross-realm intersection strategy:**

The cross-realm file only contains preferences that are classified at the **exact same tier** on **every realm**. This is the safest approach for bulk deletion across multiple realms because the analysis is fully consistent. When selected, the same list is applied to all chosen realms.

**Output created:**

```
backup/{instanceType}/{realm}_SitePreferences_backup_{date}.json
```

---

## 4. restore-preferences

```bash
node src/main.js restore-preferences
```

Restore previously deleted preferences from backup JSON files. Use this if a deletion went wrong or you need to roll back.

**Required config:**
- At least one realm in `config.json`
- A backup file in `backup/{instanceType}/` (created by `remove-preferences`)

**What it does:**
1. Select instance type and realm
2. Load the backup JSON file
3. For each preference in the backup:
   - Recreate the attribute definition via OCAPI PUT
   - Reassign to attribute groups
   - Restore site-specific values via PATCH
4. Uses retry logic for transient network errors (ECONNRESET, timeouts)

**OCAPI method override:**
- Sandbox/development: direct PUT requests
- Staging/production: POST + `x-dw-http-method-override: PUT` header (SFCC blocks direct PUT)

---

## 5. backup-site-preferences

```bash
node src/main.js backup-site-preferences
```

Trigger an SFCC backup job and download the metadata XML from WebDAV. This is a standalone backup command — separate from the backups created during `remove-preferences`.

**Required config:**
- At least one realm in `config.json`
- Backup job configured in SFCC Business Manager
- WebDAV credentials (uses same OCAPI client credentials)

**What it does:**
1. Select realm(s) to back up
2. Triggers a metadata export job via OCAPI
3. Polls job status until complete
4. Downloads the metadata XML from WebDAV

**Output:**
```
backup_downloads/{realm}_meta_data_backup_{date}.xml
backup_downloads/archive/{realm}_meta_data_backup_{date}[_{timestamp}].xml
```

---

## 6. list-sites

```bash
node src/main.js list-sites
```

List all sites for a realm and export their cartridge paths to CSV.

**Required config:**
- At least one realm in `config.json`

**What it does:**
1. Select a realm
2. Fetches all sites via OCAPI
3. For each site, reads the cartridge path configuration
4. Exports to CSV

**Output:**
```
results/{instanceType}/{realm}/{realm}_active_site_cartridges_list.csv
```

---

## 7. validate-cartridges-all (WIP)

```bash
node src/main.js validate-cartridges-all
```

Validate cartridges across ALL configured realms in parallel.

**Required config:**
- Multiple realms in `config.json`
- Sibling repository with cartridges

**Status:** Work in progress.

---

## 8. validate-site-xml (WIP)

```bash
node src/main.js validate-site-xml
```

Validate that `site.xml` files in your repository match the live SFCC cartridge path configuration.

**Required config:**
- At least one realm in `config.json`
- Sibling repository with `site.xml` files

**Status:** Work in progress.

---

## 9. Debug Commands

These commands are for development and troubleshooting. They are not part of the main workflow.

### find-preference-usage

```bash
node src/main.js find-preference-usage
```

Search cartridge code for a specific preference ID. Shows which files and cartridges reference it.

**Required config:** A sibling repository with cartridges.

---

### list-attribute-groups

```bash
node src/main.js list-attribute-groups
node src/main.js list-attribute-groups -v
```

List all attribute groups for an object type (e.g., SitePreferences).

**Options:** `-v, --verbose` — Show full JSON for first group.

**Required config:** At least one realm in `config.json`.

---

### get-attribute-group

```bash
node src/main.js get-attribute-group
```

Get full details of a specific attribute group, including all attribute definitions assigned to it.

**Required config:** At least one realm in `config.json`.

---

### test-active-preferences

```bash
node src/main.js test-active-preferences
```

Display all active preferences found in existing matrix CSV files. Does not call OCAPI — reads from local results files.

**Required config:** Matrix files in `results/` (generated by `analyze-preferences`).

---

### test-patch-attribute / test-put-attribute / test-delete-attribute

```bash
node src/main.js test-patch-attribute
node src/main.js test-put-attribute
node src/main.js test-delete-attribute
```

Test individual OCAPI write operations on a single attribute definition. Used for verifying API permissions and behavior.

**Required config:** At least one realm in `config.json`.

**⚠️ Caution:** These commands modify live data. Use on sandbox only.

---

### test-set-site-preference

```bash
node src/main.js test-set-site-preference
```

Test setting a site preference value for a specific site via OCAPI PATCH.

**Required config:** At least one realm in `config.json`.

---

### test-backup-restore-cycle

```bash
node src/main.js test-backup-restore-cycle
```

Test the full cycle: backup an attribute → delete it → restore from backup. Validates the entire backup/restore pipeline.

**Required config:** At least one realm in `config.json`.

**⚠️ Caution:** Temporarily deletes a real attribute. Use on sandbox only.

---

### find-attribute-group-in-meta

```bash
node src/main.js find-attribute-group-in-meta
```

Search for an attribute group ID in sibling repository `meta.xml` files. Useful for finding where groups are defined in your codebase.

**Required config:** A sibling repository.

---

### test-generate-backup-json

```bash
node src/main.js test-generate-backup-json
```

Generate a SitePreferences backup JSON from the deletion list and usage CSV without calling OCAPI. Tests the backup generation logic offline.

**Required config:** Deletion file and usage CSV in `results/`.

---

### test-concurrent-timers / debug-progress

```bash
node src/main.js test-concurrent-timers
node src/main.js debug-progress
```

Internal development tools for testing the progress display and logging system.

**Required config:** None.
