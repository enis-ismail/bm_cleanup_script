# AGENTS.md - Cleanup Script Project Agents & Capabilities

This document defines the AI agents and their capabilities for the Cleanup-Script project.

## Project Overview
- **Project Name:** Cleanup-Script
- **Project Code:** CLEANUPSCRIPT
- **Domain:** Site Preferences & Configuration Management
- **Type:** Utility / Maintenance Tool
- **Purpose:** Analyze and clean up unused Salesforce Commerce Cloud (SFCC) site preferences

---

## Primary Agent Capabilities

### 1. API Integration Agent
**Capability:** Interact with SFCC OCAPI (Open Commerce API) endpoints

- **Scope:** 
  - OAuth authentication & session management
  - Site preference retrieval via OCAPI
  - Backup job triggering & WebDAV downloads
  - Batch processing with rate limiting

- **Files:** 
  - [src/api.js](src/api.js)
  - [src/helpers/backupJob.js](src/helpers/backupJob.js)
  - [src/helpers/batch.js](src/helpers/batch.js)
  - [ocapi_config.json](ocapi_config.json)

- **Key Functions:**
  - `getAllSites()`, `getSiteById()` - Site retrieval
  - `getAttributeGroups()`, `getSitePreferences()` - Preference data
  - `getAttributeDefinitionById()` - Detailed definitions with defaults
  - `processBatch()` - Parallel batch processing with delays
  - `withLoadShedding()` - Rate limit handling
  - `refreshMetadataBackupForRealm()` - Backup job trigger + download

---

### 2. Data Processing Agent
**Capability:** Process and analyze preference data

- **Scope:**
  - CSV matrix generation (preference × site usage)
  - Preference usage analysis across cartridges
  - Deprecation logic (unused + not in code)
  - Backup file generation and metadata merging

- **Files:**
  - [src/helpers/preferenceHelper.js](src/helpers/preferenceHelper.js)
  - [src/helpers/preferenceUsage.js](src/helpers/preferenceUsage.js)
  - [src/helpers/preferenceRemoval.js](src/helpers/preferenceRemoval.js)
  - [src/helpers/preferenceBackup.js](src/helpers/preferenceBackup.js)
  - [src/helpers/summarize.js](src/helpers/summarize.js)
  - [src/helpers/csv.js](src/helpers/csv.js)

- **Key Functions:**
  - `buildPreferenceMeta()` - Normalize OCAPI definitions
  - `processSitesAndGroups()` - Aggregate site preference values
  - `buildPreferenceMatrix()` - Generate usage matrix
  - `findUnusedPreferences()` - Identify preferences with no values
  - `findAllActivePreferencesUsage()` - Scan cartridge code for references
  - `generatePreferenceDeletionCandidates()` - Build safe deletion list
  - `generateBackupFromDefinitions()` - Create backup JSON files
  - `updateBackupFileAttributeGroups()` - Merge XML metadata into backup

---

### 3. Utility & Configuration Agent
**Capability:** Configuration, logging, and workflow orchestration

- **Scope:**
  - Multi-realm configuration management
  - Interactive CLI prompts
  - Progress tracking and status logging
  - File system utilities

- **Files:**
  - [src/helpers.js](src/helpers.js)
  - [src/helpers/log.js](src/helpers/log.js)
  - [src/helpers/util.js](src/helpers/util.js)
  - [src/helpers/constants.js](src/helpers/constants.js)
  - [src/prompts.js](src/prompts.js)
  - [src/main.js](src/main.js)

- **Key Functions:**
  - `getSandboxConfig()`, `getRealmsByInstanceType()` - Config retrieval
  - `addRealmToConfig()`, `removeRealmFromConfig()` - Realm management
  - `resolveRealmScopeSelection()` - Multi-realm prompts
  - `logStatusUpdate()`, `logProgress()` - User feedback
  - `ensureResultsDir()`, `getSiblingRepositories()` - File utilities
  - Command orchestration in [src/main.js](src/main.js)

---

### 4. Code Analysis Agent
**Capability:** Scan cartridge code for preference references

- **Scope:**
  - Multi-file batch scanning (optimized)
  - Deprecated cartridge filtering
  - Preference usage mapping
  - File type filtering (.js, .isml, .ds, .json, .xml)

- **Files:**
  - [src/helpers/preferenceUsage.js](src/helpers/preferenceUsage.js)
  - [src/helpers/cartridgeCommands.js](src/helpers/cartridgeCommands.js)
  - [src/helpers/cartridgeComparison.js](src/helpers/cartridgeComparison.js)

- **Key Functions:**
  - `findAllActivePreferencesUsage()` - Batch scan all preferences
  - `getActivePreferencesFromMatrices()` - Extract preference list from CSVs
  - `getDeprecatedCartridges()` - Parse comparison files
  - `getCartridgeNameFromPath()` - Extract cartridge from file path
  - `exportCartridgePreferenceMapping()` - Generate usage reports

---

## Supported Data Formats

### Input
- JSON responses from SFCC OCAPI
- CSV files with preference data
- Configuration files (JSON)

### Output
- CSV matrices (usage, summary)
- TXT reports (unused preferences)
- JSON summaries

### Sample Files
Located in [test-runs/](test-runs/):
- `bcwr-080_sandbox_preferences_response.json`
- `bcwr-080_sandbox_preferences_matrix.csv`
- `bcwr-080_unused_preferences.txt`

---

## Configuration & Environment

### Configuration Files
- [config.json](config.json) - Active project configuration
- [config.example.json](config.example.json) - Configuration template
- [ocapi_config.json](ocapi_config.json) - OCAPI endpoint settings

### Environment Requirements
- **Node Engine:** >=16.0.0 (from package.json)
- **Required Packages:** See [package.json](package.json)

---

## Deprecation Logic & Workflow

### Three-Level Analysis

**Level 1: Matrix Analysis (per realm)**

A preference is "unused" IF:
- No site has a value (no "X" marks in matrix)
- AND no default value exists

→ Output: `{realm}_unused_preferences.txt`

**Level 2: Cartridge Code Scan**

Scans repository cartridges for ALL active preferences:
- **Includes:** .js, .isml, .ds, .json, .xml, .properties files
- **Excludes:** sites folder, .git, node_modules, deprecated cartridges
- Records which cartridges reference each preference
- Tags deprecated cartridge usage as `[possibly deprecated]`

→ Output:
- `{instance}_unused_preferences.txt` - No cartridge usage found
- `{instance}_cartridge_preferences.txt` - Cartridge → preference mapping

**Level 3: Final Deletion Candidates**

A preference is SAFE TO DELETE IF:
- It's in unused_preferences.txt (no values anywhere)
- AND NOT in cartridge_preferences.txt (never mentioned in active code)

→ Output: `{instance}_preferences_for_deletion.txt`

### Workflow: analyze-preferences → remove-preferences

```
1. analyze-preferences
   ↓
   Fetch prefs from SFCC → Generate matrices → Scan code
   ↓
   Create: preferences_for_deletion.txt

2. remove-preferences
   ↓
   Load deletion list → Review in VS Code → Confirm
   ↓
   Verify backups → Remove preferences via OCAPI (TODO)
```

---

## Results & Artifacts

Output directory structure:
```
backup/
├── development/
│   └── {realm}_SitePreferences_backup_{date}.json
├── sandbox/
│   └── {realm}_SitePreferences_backup_{date}.json
└── staging/
    └── ...

backup_downloads/
└── {instance}_{realm}_meta_data_backup.xml

results/
├── development/
│   ├── ALL_REALMS/
│   │   ├── ALL_REALMS_cartridge_comparison.txt
│   │   ├── ALL_REALMS_unused_preferences.txt
│   │   ├── development_cartridge_preferences.txt
│   │   ├── development_preference_usage.txt
│   │   ├── development_preferences_for_deletion.txt  ← MAIN DELETION LIST
│   │   └── development_unused_preferences.txt
│   ├── {realm}/
│   │   ├── {realm}_active_site_cartridges_list.csv
│   │   ├── {realm}_development_preferences_matrix.csv
│   │   ├── {realm}_development_preferences_usage.csv
│   │   └── {realm}_unused_preferences.txt
│   └── ...
├── sandbox/
│   └── ...
└── staging/
    └── ...
```

---

## Development Notes

### Code Quality Standards

**Variable Declaration Pattern:**
- Move ALL variable declarations to the **top of the function**
- Declare variables with their actual assigned values immediately, not empty
- Only use `let` for conditionally-assigned variables (no value at declaration time)
- Example:
  ```javascript
  // ✓ CORRECT - declare with immediate value
  const cartridges = findCartridgeFolders(repositoryPath);
  const sandbox = getSandboxConfig(realm);
  
  // ✓ CORRECT - declare empty only if conditionally assigned later
  let filePath;
  if (condition) {
    filePath = await someAsyncFunction();
  }
  ```
- **Linting:** ESLint enforces 120 character line limit; split declarations across multiple lines if needed

**Related Files:**
- ESLint configuration: [eslint.config.js](eslint.config.js)
- Main entry point: [src/main.js](src/main.js)
- All helper files in [src/helpers/](src/helpers/) follow this pattern

### Process Documentation
- User guide: [site preference cleanup script.txt](site%20preference%20cleanup%20script.txt)
- Project README: [README.md](README.md)

### Test Data
Test responses are stored in [test-runs/](test-runs/) directory for reference and debugging.

---

## Commands Reference

### Production Commands
- `analyze-preferences` - Full analysis workflow (fetch → scan → generate deletion list)
- `remove-preferences` - Remove preferences marked for deletion (WIP: deletion not implemented)
- `backup-site-preferences` - Trigger backup job and download metadata
- `list-sites` - Export site cartridge paths to CSV
- `add-realm` / `remove-realm` - Realm configuration management

### Work-in-Progress Commands
- `validate-cartridges-all` - Multi-realm cartridge validation
- `validate-site-xml` - Site.xml vs. live cartridge comparison

---

## Next Steps for Agents

When working on this project:

1. **Preference Analysis:** Use Data Processing + Code Analysis Agents
2. **SFCC Integration:** Use API Integration Agent
3. **Deletion Implementation:** Implement OCAPI DELETE in remove-preferences Step 4
4. **Backup/Restore:** Use API Integration + preferenceBackup helper
5. **Configuration:** Use Utility & Configuration Agent

### Outstanding Implementation
- ⚠️ `remove-preferences` Step 4: Actual OCAPI preference deletion
- Consider: Should deprecated cartridge usage block deletion?

---

*Last Updated: February 17, 2026*
*Project Structure: Maintained by AI agents*
