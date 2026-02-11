# Cleanup Script - Development TODO

## Phase 1: Removal Implementation
- [ ] **Implement preference removal via OCAPI**
  - Use `DELETE` endpoint on system_object_definitions
  - Target: Unused preferences/preference groups identified from analysis
  - Add logic to `updateAttributeDefinitionById()` or create separate delete handler

## Phase 2: Analysis & Determination
- [ ] **Combine all realms results for analysis**
  - Read all preference matrix files from `results/*/` directories
  - Create consolidated view: Which preferences exist where
  - Merge usage data across all realms

- [ ] **Determine realm-specific vs global preferences**
  - Identify preferences used in ALL realms (candidates for centralization)
  - Identify preferences used in only 1-2 realms (candidates for removal)
  - Identify preferences used with different values per realm
  - Flag preferences that should move to a single realm

## Phase 3: Repository Updates
- [ ] **Create backup system for attribute definitions**
  - Store JSON object per system-attribute-definition
  - Include entire setup + value per site
  - Location: `backups/` directory with timestamp/realm structure
  - Enable quick revert if removal causes issues

- [ ] **Locate meta.xml files in repository**
  - Search cartridges for `meta.xml` files containing preference references
  - Build index: Which cartridges reference which preferences
  - Support for linked repositories (siblings)

- [ ] **Parse and update meta.xml files**
  - Remove preference group/attribute references from meta.xml
  - Handle moving preferences between realms
  - Preserve formatting and structure
  - Create backup of original meta.xml before modification

## Phase 4: Workflow Execution
- [ ] **Execute removal workflow independently**
  - Use generated files from initial fetch as source
  - Don't require live API access for removal decisions
  - Support dry-run mode before actual deletion

- [ ] **Create revert/restore from backup logic**
  - Ability to restore attribute definitions from backup
  - Restore preference values per site
  - Provide rollback option

---

## Dependencies Between Tasks

```
Phase 1 (Removal) ← Phase 2 (Analysis) → Phase 3 (Repository)
                         ↓
                    Phase 4 (Execution)
```

## Files to Create/Modify

- `src/helpers/removalHelper.js` - Removal logic
- `src/helpers/analysisHelper.js` - Multi-realm analysis
- `src/helpers/metaXmlHelper.js` - meta.xml parsing/updating
- `src/helpers/backupHelper.js` - Backup/restore logic
- `src/backup/` - Backup storage directory
- Update `debug.js` with new removal commands

---

## Generated Files Already Available
Using existing output from fetch phase:
- `results/{realm}/*/preferences_matrix.csv` - What preferences exist where
- `results/{realm}/*/preferences_usage.csv` - How often used per realm
- `results/{realm}/*/unused_preferences.txt` - Candidates for removal
- Site-specific values already captured per realm

