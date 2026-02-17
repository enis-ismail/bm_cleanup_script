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

---

## ⚠️ Current Gaps & Next Steps

### Priority 1: Complete Removal Implementation

**A. Implement OCAPI Preference Deletion**
- [ ] Research correct OCAPI endpoint for preference deletion
  - Document API endpoint and parameters
  - Verify permissions required
  - Test on sandbox first
- [ ] Create `deleteAttributeDefinitionById()` function in api.js
- [ ] Add deletion logic to remove-preferences Step 4
- [ ] Implement error handling and rollback on failure
- [ ] Add dry-run mode for testing without actual deletion
- [ ] Log each deletion attempt (success/failure)

**B. Backup & Restore System**
- [ ] Implement restore function from backup JSON
- [ ] Test full backup → delete → restore cycle
- [ ] Add verification after restore (compare before/after)
- [ ] Document rollback procedure

---

### Priority 2: Clarify Deprecation Logic

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

### Priority 3: Enhanced Analysis

**Multi-Realm Analysis Improvements**
- [ ] Preference centralization detection
  - Flag preferences used in ALL realms (consolidation candidates)
  - Flag preferences used in 1-2 realms only
  - Suggest moving realm-specific preferences
- [ ] Value discrepancy detection
  - Find preferences with different values across realms
  - Highlight potential configuration issues
- [ ] Usage frequency analysis
  - Track how often preferences are referenced in code
  - Identify rarely-used preferences (technical debt)

---

### Priority 4: Repository Meta.xml Updates

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
- [ ] `metaXmlHelper.js` - Meta.xml parsing (future)
- [ ] `restoreHelper.js` - Backup restore logic (future)

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

## 🔍 Testing & Validation

### Unit Testing
- [ ] Add unit tests for core functions
  - Preference detection logic
  - CSV parsing and generation
  - Backup file validation
- [ ] Add integration tests
  - End-to-end workflow testing
  - OCAPI mock server for testing

### Manual Testing Checklist
- [x] Single realm analysis
- [x] Multi-realm analysis
- [x] ALL_REALMS scope
- [x] Deprecated cartridge filtering
- [x] Backup file generation
- [x] Backup age checking
- [ ] Actual preference deletion (not implemented)
- [ ] Rollback from backup (not implemented)

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