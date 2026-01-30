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
  - Authentication & session management
  - Site preference retrieval
  - Sandbox communication

- **Files:** 
  - [src/api.js](src/api.js)
  - [ocapi_config.json](ocapi_config.json)

- **Key Functions:**
  - Authenticate with SFCC sandbox
  - Fetch site preferences data
  - Query active cartridges

---

### 2. Data Processing Agent
**Capability:** Process and analyze preference data

- **Scope:**
  - CSV file handling
  - Data structure transformation
  - Matrix generation
  - Usage analysis

- **Files:**
  - [src/csvHelper.js](src/csvHelper.js)
  - [src/main.js](src/main.js)
  - [src/summarizeHelper.js](src/summarizeHelper.js)

- **Key Functions:**
  - Parse preference responses
  - Generate usage matrices
  - Identify unused preferences
  - Create summary reports

---

### 3. Utility Helper Agent
**Capability:** Common utilities and helpers

- **Scope:**
  - Logging
  - Configuration management
  - User prompts & interaction

- **Files:**
  - [src/helpers.js](src/helpers.js)
  - [src/logger.js](src/logger.js)
  - [src/prompts.js](src/prompts.js)

- **Key Functions:**
  - Console logging with timestamps
  - Configuration validation
  - User input handling
  - Error reporting

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

## Results & Artifacts

Output directory structure:
```
results/
├── {sandbox}/
│   ├── {sandbox}_sandbox_preferences_matrix.csv
│   ├── {sandbox}_sandbox_preferences_usage.csv
│   └── {sandbox}_unused_preferences.txt
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

## Next Steps for Agents

When working on this project:

1. **Data Analysis Tasks:** Use the Data Processing Agent
2. **SFCC Integration Tasks:** Use the API Integration Agent  
3. **Configuration/Support Tasks:** Use the Utility Helper Agent
4. **Report Generation:** Use Data Processing Agent with appropriate templates

---

*Last Updated: January 29, 2026*
*Project Structure: Maintained by AI agents*
