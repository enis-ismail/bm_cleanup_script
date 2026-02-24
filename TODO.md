# Cleanup Script - Development TODO

## Status: Current Implementation

### ✅ Completed Features

**Analysis Workflow (`analyze-preferences`)**
- [x] Multi-realm configuration management
- [x] OCAPI integration with OAuth authentication
- [x] Site preference retrieval with batch processing
- [x] Default value fetching from attribute definitions
- [x] Backup file generation (JSON format per realm)
- [x] Matrix generation (preference × site usage)
- [x] Usage CSV generation (actual values per site)
- [x] Unused preference detection (no values + no defaults)
- [x] Cartridge code scanning for preference references
- [x] Deprecated cartridge filtering
- [x] Final deletion candidate generation
- [x] Multi-realm consolidation (ALL_REALMS scope)
- [x] Backup age checking (reuse <14 day backups)

**Removal Workflow (`remove-preferences` - Partial)**
- [x] Load deletion candidates from file
- [x] Interactive review in VS Code
- [x] Confirmation prompts with summary
- [x] Backup verification per realm
- [x] Metadata backup job trigger + download
- [x] XML metadata merging into backup files
- [x] Separate backup command (`backup-site-preferences`)

**Supporting Features**
- [x] Realm management (add/remove)
- [x] Site listing and cartridge export
- [x] Rate limiting and load shedding
- [x] Progress tracking and logging
- [x] Cartridge comparison and validation (WIP)
- [x] Site.xml validation (WIP)
- [x] Preference restore functionality (restoreHelper.js)
- [x] Preference blacklist/whitelist for ignored preferences
- [x] Refine deletion candidate logic with priority ranking
- [x] Create logic that defines which preferences are used in what realms
  - [x] Per-realm value maps for deletion targeting
  - [x] Per-realm cartridge sets for code-per-realm analysis
  - [x] Realm tags on deletion candidates (ALL or specific realms)
  - [x] P5 tier: Active code only in some realms
  - [ ] **TEST:** Validate per-realm deletion in remove-preferences workflow
  - [ ] **TEST:** Verify realm tag parsing and per-realm preference mapping
  - [ ] **TEST:** Check P5 tier generation with real code scan results
- [ ] Create a command to map where preferences are used and if they should be moved to specific realms
  - [ ] Identify preferences that are used in ALL realms (consolidation candidates)
  - [ ] Identify preferences that are used in only 1 realm
  - [ ] add logic to suggest moving realm-specific preferences to specific realms if they are only used there
- [ ] add depricated cartridge logic 
  - [ ] create logic to create new git branches (determine a base branch, naming convention, etc.)
  - [ ] add logic to automatically commit changes to the new branch with a standardized commit message
  - [ ] add logic to create pull requests from the new branch to a target branch
- [ ] we need to be able to create a deletionlist for each realm that is based on the preferences that are only used in that realm, this way we can delete more preferences and also have a better overview of which preferences are used where
- [ ] when we failt to retrieve a preference through OCAPI we should remember the ID to try fetching it later.

---

## ⚠️ Current Gaps & Next Steps

### Priority 1: Complete Removal Implementation

**A. Implement OCAPI Preference Deletion**
- [ ] Research correct OCAPI endpoint for preference deletion
  - Document API endpoint and parameters
  - Verify permissions required
  - Test on sandbox first
- [x] Add deletion logic to remove-preferences Step 4
- [ ] Implement error handling and rollback on failure
- [x] Add dry-run mode for testing without actual deletion
- [ ] Log each deletion attempt (success/failure)

**B. Backup & Restore System**
- [x] Implement restore function from backup JSON (restoreHelper.js)
- [x] Test full backup → delete → restore cycle
- [ ] Add verification after restore (compare before/after)
- [ ] Document rollback procedure

---

### Priority 2: Refine Deletion Candidate Logic

**Current Behavior:**
- Preferences are classified by priority into 4 tiers based on code usage, deprecation status, and value data
- Active code references block deletion; deprecated-only and value-status determine ranking

**Priority-Based Deletion Candidate Ranking: ✅ Implemented**
- [x] Implement priority-based deletion candidate ranking:
  1. **Code Reference Check** (highest priority)
     - Block deletion if actively used in non-deprecated code
     - Flag but allow deletion if only in deprecated cartridges
  2. **Cartridge Usage Analysis** (medium priority)
     - Check which cartridges declare/use the preference
     - Consider cartridge deprecation status
  3. **Assigned Values Check** (lowest priority)
     - Check if ANY site has values assigned
     - Check if default values exist
- [x] Create multi-tier deletion list (single file with priority sections):
  - `[P1]` Safe to Delete — No code, no values, no usage
  - `[P2]` Likely Safe — No code, but has values/defaults
  - `[P3]` Review: Deprecated Only — Only in deprecated cartridges, no values
  - `[P4]` Review: Deprecated + Values — Only in deprecated cartridges, has values
- [ ] Allow override flags in CLI for aggressive deletion modes

---

### Priority 3: Preference Blacklist System

**Status: ✅ Implemented**

Preferences in `preference_blacklist.json` are automatically excluded from deletion candidate lists.
Supports exact match, wildcard, and regex pattern types.

**CLI Commands:**
- `add-to-blacklist` — Interactive prompt to add entries
- `remove-from-blacklist` — Select and remove entries
- `list-blacklist` — Display all blacklisted patterns

**Integration Points:**
- [x] `preference_blacklist.json` configuration file in project root
- [x] `src/helpers/blacklistHelper.js` — load, save, match, filter logic
- [x] `src/io/codeScanner.js` — `generatePreferenceDeletionCandidates()` filters candidates (primary)
- [x] `src/commands/preferences/helpers/preferenceRemoval.js` — `loadPreferencesForDeletion()` safety net
- [x] `src/commands/setup/blacklist.js` — CLI commands registered in main.js
- [x] Deletion output file includes a "Blacklisted Preferences (Protected)" section

---

### Priority 4: Metadata XML Optimization

**Status: 🔄 In Progress**

**Problem:** The `analyze-preferences` workflow makes ~500+ OCAPI calls for attribute definitions
(paginated list + individual fetch for default_value) and group definitions, while the BM metadata
XML (`backup_downloads/`) already contains all of this data in one file.

**OCAPI calls XML can replace:**
- `getSitePreferences()` — paginated attribute list (~3-4 pages)
- `getAttributeDefinitionById()` — individual default-value fetches (~500+ calls)
- `getAttributeGroups()` — paginated group list (~1-2 pages)

**OCAPI calls still needed (site-level data not in XML):**
- `getAllSites()` — 1 call
- `getSiteById()` — ~20 calls (per site)
- `getSitePreferencesGroup()` — ~600 calls (sites × groups for actual values)

**Implementation:**
- [x] `siteXmlHelper.js` — Refactored XML parsing with shared helpers
  - `parseRawAttributeDefinitions()` — private, returns raw xml2js nodes
  - `convertXmlAttrDefToOcapi()` — private, converts to OCAPI-compatible format
  - `getAllAttributeDefinitionsFromMetadata()` — exported, returns ALL definitions without filtering
- [x] `analyzer.js` — Added metadata-based data fetching
  - `fetchPreferenceDataFromMetadata()` — reads attrs+groups from XML, sites from OCAPI
  - `executePreferenceSummarizationFromMetadata()` — exported orchestrator
- [x] `preferences.js` — `debug-analyze-preferences` command
  - Checks for existing metadata XML per realm
  - Offers to trigger BM backup job if XML not found
  - Uses `executePreferenceSummarizationFromMetadata()` for Step 2
  - Steps 3-5 (matrix check, active prefs, code scan) identical to `analyze-preferences`
- [ ] **TEST:** Run `debug-analyze-preferences` end-to-end on sandbox
- [ ] **TEST:** Compare output (attribute counts, matrix, deletion candidates) between OCAPI and metadata modes
- [ ] Migrate `analyze-preferences` to use metadata mode by default (once validated)
- [ ] Add metadata freshness checking (prompt to refresh if > 7 days old)

---

### Priority 5: Clarify Deprecation Logic

**Current Behavior:**
- Preferences found ONLY in deprecated cartridges are tagged `[possibly deprecated]`
- They appear in cartridge_preferences.txt but still block deletion

**Decision Needed:**
- [ ] Should deprecated cartridge usage block deletion?
- [ ] Should we create a separate review category?
- [ ] Should we auto-delete deprecated-only usage?

**Options:**
1. **Conservative (current):** Don't delete if ANY code references it
2. **Aggressive:** Ignore deprecated cartridge usage entirely
3. **Manual Review:** Add `preferences_for_review.txt` for deprecated-only

---

### Priority 6: Enhanced Analysis

**Multi-Realm Preference Analysis**
- [ ] Implement logic to track preference usage per realm.
  - [ ] Generate a report of preferences used in ALL realms (consolidation candidates).
  - [ ] Generate a report of preferences used in only ONE realm.
- [ ] Add a new step to suggest moving realm-specific preferences into realm-specific cartridges if they are only used there.
- [ ] **Value Discrepancy Detection:**
  - [ ] Find preferences with different values across realms.
  - [ ] Highlight potential configuration inconsistencies in the summary report.
- [ ] **Usage Frequency Analysis:**
  - [ ] Track how often preferences are referenced in code.
  - [ ] Identify rarely-used preferences as potential technical debt.

---

### Priority 7: Repository Meta.xml Updates

**Cartridge Meta.xml Management**
- [ ] Scan cartridges for meta.xml files
  - Index which cartridges declare which preferences
  - Detect orphaned preferences (in meta.xml but not in SFCC)
  - Detect undeclared preferences (in SFCC but not in meta.xml)
- [ ] Auto-update meta.xml after deletion
  - Remove deleted preference definitions
  - Preserve formatting and structure
  - Create backup before modification
- [ ] Support for sibling repositories
  - Scan multiple related repositories
  - Cross-reference preference usage

---

### Priority 8: Git Integration & Automation

**Automated Deprecated Cartridge Handling**
- [ ] **Branch Creation:**
  - [ ] Implement logic to create a new git branch for cartridge-related changes.
  - [ ] Define a strategy for determining the base branch (e.g., `main`, `develop`).
  - [ ] Establish a clear branch naming convention (e.g., `chore/remove-deprecated-cartridge-XYZ`).
- [ ] **Automated Commits:**
  - [ ] Add logic to automatically commit changes (e.g., updated `cartridges/` folder, `package.json`).
  - [ ] Use a standardized commit message format for tracking.
- [ ] **Pull Request Generation:**
  - [ ] Implement logic to create a pull request from the new branch to a target branch.
  - [ ] Pre-fill the PR with details about the deprecated cartridge being removed.
- [ ] **Helper Module:**
  - [ ] Create a `gitHelper.js` to encapsulate all Git-related commands (`simple-git` library).

---

## 📂 File Structure Progress

### Helper Files (src/helpers/)
- [x] `api.js` - OCAPI integration
- [x] `backupJob.js` - Backup job triggering
- [x] `batch.js` - Batch processing with delays
- [x] `preferenceHelper.js` - Preference processing
- [x] `preferenceUsage.js` - Code scanning
- [x] `preferenceRemoval.js` - Deletion workflow (partial)
- [x] `preferenceBackup.js` - Backup generation
- [x] `summarize.js` - Data aggregation
- [x] `csv.js` - CSV generation
- [x] `cartridgeCommands.js` - Cartridge validation
- [x] `cartridgeComparison.js` - Cartridge comparison
- [x] `log.js` - Logging utilities
- [x] `util.js` - File system utilities
- [x] `constants.js` - Configuration constants
- [x] `timer.js` - Timing utilities
- [x] `restoreHelper.js` - Backup restore logic
- [ ] `metaXmlHelper.js` - Meta.xml parsing (future)
- [x] `blacklistHelper.js` - Preference blacklist management
- [ ] `metadataManager.js` - Centralized metadata handling (future)
- [ ] `gitHelper.js` - Git integration and automation (future)

### Directory Structure
```
backup/                     ✅ Implemented
├── development/
├── sandbox/
└── staging/

backup_downloads/           ✅ Implemented
└── *_meta_data_backup.xml

results/                    ✅ Implemented
├── development/
│   ├── ALL_REALMS/         ✅ Consolidated results
│   └── {realm}/            ✅ Per-realm results
├── sandbox/
└── staging/
```

---

## 🔍 Validation

### Manual Testing Checklist
- [x] Single realm analysis
- [x] Multi-realm analysis
- [x] ALL_REALMS scope
- [x] Deprecated cartridge filtering
- [x] Backup file generation
- [x] Backup age checking
- [x] Actual preference deletion
- [x] Rollback from backup
- [ ] fix logging issues and improve batch progress visibility

---

## 🚀 Future Enhancements

### Performance Optimizations
- [ ] Cache OCAPI responses to reduce API calls
- [ ] Parallelize realm processing further
- [ ] Add progress persistence (resume interrupted analysis)

### User Experience
- [ ] Add interactive web dashboard
- [ ] Visualize preference usage graphs
- [ ] Export reports to PDF/Excel
- [ ] Email notifications for completed jobs

### Advanced Features
- [ ] Preference migration between realms
- [ ] Auto-detect preference naming conventions
- [ ] Suggest preference consolidation opportunities
- [ ] Integration with CI/CD pipelines

---

## 📝 Notes & Decisions

### Deprecation Logic Decision (Pending)
**Question:** Should preferences found ONLY in deprecated cartridges be deleted?

**Current State:** Tagged as `[possibly deprecated]` but still block deletion

**Options:**
1. Conservative: Keep current behavior (don't delete)
2. Aggressive: Ignore deprecated cartridge usage
3. Hybrid: Add manual review category

**Decision:** TBD by team

### Backup Strategy
- Backups stored as JSON (structured format)
- XML metadata merged for attribute groups
- 14-day age limit for reusing cached backups
- Manual backup command available separately

---

## Dependencies Between Tasks

```
Priority 1 (Deletion)  ←→  Priority 2 (Deprecation Logic)
         ↓
Priority 3 (Analysis)  ←→  Priority 4 (Meta.xml)
         ↓
    Future Enhancements
```

---

*Last Updated: February 17, 2026*
*Maintained by development team*


*Last Updated: February 17, 2026*
*Maintained by development team*