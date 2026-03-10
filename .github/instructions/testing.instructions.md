---
applyTo: "tests/**"
---
# Testing Conventions & Skill File

Rules and patterns for writing tests in this project. Follow these conventions when
creating or modifying test files.

---

## 1. Framework & Configuration

- **Framework:** Vitest v4.0.18 with `@vitest/coverage-v8`
- **Config:** `vitest.config.js` — globals enabled, 10s timeout, include `tests/**/*.test.js`
- **Run tests:** `npx vitest run` or `npm test`
- **Run coverage:** `npx vitest run --coverage`
- **Run single file:** `npx vitest run tests/io/codeScanner.test.js`

---

## 2. File & Directory Structure

```
tests/
├── io/
│   ├── csv.test.js              ← tests for src/io/csv.js
│   ├── codeScanner.test.js      ← tests for src/io/codeScanner.js
│   └── siteXmlHelper.test.js    ← tests for src/io/siteXmlHelper.js
├── helpers/
│   ├── summarize.test.js        ← tests for src/helpers/summarize.js
│   └── analyzer.test.js         ← tests for src/helpers/analyzer.js
├── commands/
│   ├── preferences/
│   │   ├── preferenceRemoval.test.js
│   │   ├── backupHelpers.test.js
│   │   └── deleteHelpers.test.js
│   └── meta/
│       ├── metaFileCleanup.test.js
│       └── metaConsolidation.test.js
└── fixtures/                    ← Shared fixture data (optional)
    └── ...
```

**Naming:** Test file mirrors source path: `src/io/csv.js` → `tests/io/csv.test.js`

---

## 3. Import Pattern

Always import Vitest helpers explicitly (globals are enabled but explicit is clearer):

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
```

---

## 4. Mocking Strategy

### 4.1 Module Mocks (for dependencies)

Use `vi.mock()` BEFORE importing the module under test. This is required for ESM:

```javascript
// Mock external dependencies first
vi.mock('../../../src/io/util.js', () => ({
    ensureResultsDir: vi.fn(),
    findAllMatrixFiles: vi.fn(() => []),
    findAllUsageFiles: vi.fn(() => []),
    getResultsPath: vi.fn((realm) => `/mock/results/${realm}`)
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getRealmsByInstanceType: vi.fn(() => ['EU05', 'APAC', 'PNA', 'GB'])
}));

vi.mock('../../../src/commands/setup/helpers/blacklistHelper.js', () => ({
    loadBlacklist: vi.fn(() => ({ blacklist: [] })),
    filterBlacklisted: vi.fn((ids) => ({ allowed: ids, blocked: [] }))
}));

// THEN import the module under test
import { myFunction } from '../../../src/io/codeScanner.js';
```

### 4.2 API Mocks

API calls should ALWAYS be mocked. Never let tests hit real SFCC endpoints:

```javascript
vi.mock('../../../src/api/api.js', () => ({
    getAllSites: vi.fn(),
    getSitePreferences: vi.fn(),
    getAttributeGroups: vi.fn()
}));
```

### 4.3 File System — Temp Directories

For functions that read/write files, use real temp directories with real file I/O.
This tests actual parsing logic without mocking fs:

```javascript
let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-prefix-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});
```

### 4.4 Console Suppression

Suppress console output in tests to keep test output clean:

```javascript
beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
```

---

## 5. Fixture Data — Use Real Result Files

The project has real result files in `results/`, `backup/`, and `backup_downloads/`.
Use their formats as fixture data. This ensures tests validate actual parsing logic.

### 5.1 Unused Preferences File Format
```
Unused Preferences for [REALM]
Instance: [instanceType]
Total unused: [count]

--- Preference IDs ---
c_prefA
c_prefB
...
```

### 5.2 Matrix CSV Format
```csv
preferenceId,defaultValue,SiteName1,SiteName2,...
c_enableFeature,,X,
c_maxRetries,3,,X
c_unusedPref,,,
```

- `X` in a site column = site has a value
- Empty = no value on that site
- `defaultValue` column may have complex JSON strings in quotes

### 5.3 Per-Realm Deletion File Format
```
Site Preferences — Deletion Candidates for [REALM]
Generated: [ISO date]
Instance Type: [instanceType]
Realm: [realm]

Analysis Summary:
  • Total preferences analyzed: [N]
  • [P1] Safe to delete: [N]
  • [P2] Likely safe: [N]
  ...

--- [P1] Safe to Delete (No Code, No Values on [REALM]) --- [N preferences]
c_prefA
c_prefB  |  ⚠ dynamic value of: c_parentPref

--- [P2] Likely Safe (No Code, Has Values on [REALM]) --- [N preferences]
c_prefC  |  has default value  |  sites with values: 3
c_prefD  |  sites with values: 1
```

### 5.4 Cartridge Preferences File Format
```
Cartridge Preferences — Code Reference Analysis
...
Found X preferences with cartridge references:

int_some_cartridge (3 preferences)
	•	c_prefA
	•	c_prefB
	•	c_prefC

app_custom_brand (2 preferences)
	•	c_prefD
	•	c_prefE
```

### 5.5 Cross-Realm Deletion Candidates Format
```
Site Preferences — Cross-Realm Deletion Candidates (Intersection)
...
--- [P1] Safe to Delete on All Realms (No Code, No Values) --- [N preferences]
c_prefA
c_prefB

--- [P2] Likely Safe on All Realms (No Code, Has Values) --- [N preferences]
c_prefC  |  has default value  |  sites with values: 2
```

### 5.6 OCAPI Backup JSON Format
```json
{
    "count": 3,
    "data": [
        {
            "id": "c_prefName",
            "display_name": { "default": "Display Name" },
            "type": "string",
            "value_definitions": []
        }
    ]
}
```

---

## 6. Test Structure

### 6.1 Group by Function

Use `describe` blocks per exported function. Separate logical groups with comment bars:

```javascript
// ============================================================================
// functionName
// ============================================================================

describe('functionName', () => {
    // ... tests
});
```

### 6.2 Focus: Parsing Correctness

Priority is testing that files are **read and interpreted correctly**:
- Correct preference IDs extracted
- Correct tier classification (P1-P5)
- Correct value/default detection from matrix CSVs
- Correct cartridge → preference mapping
- Correct realm filtering

### 6.3 Test Naming

Use descriptive `it()` names that state the expected behavior:

```javascript
it('extracts preference IDs from unused preferences file', () => { ... });
it('classifies P1 when no code refs and no values', () => { ... });
it('promotes to P2 when preference has values on some sites', () => { ... });
```

### 6.4 Skip Failure Cases (For Now)

Focus on the happy path — correct parsing and interpretation.
Do NOT prioritize error handling or edge-case failure tests.

---

## 7. Common Patterns

### 7.1 Testing File Parsers

```javascript
it('parses the expected format', () => {
    const content = [
        'Header line',
        '',
        '--- Preference IDs ---',
        'c_prefA',
        'c_prefB'
    ].join('\n');

    const filePath = path.join(tmpDir, 'test_file.txt');
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = parseFunction(filePath);

    expect(result.size).toBe(2);
    expect(result.has('c_prefA')).toBe(true);
    expect(result.has('c_prefB')).toBe(true);
});
```

### 7.2 Testing CSV Parsers (Matrix)

```javascript
it('detects values and defaults from matrix CSV', () => {
    const csvContent = [
        'preferenceId,defaultValue,EU,GB',
        'c_hasBoth,true,X,X',
        'c_defaultOnly,fallback,,',
        'c_valuesOnly,,X,',
        'c_nothing,,,'
    ].join('\n');

    // Write to temp dir and invoke function
    const filePath = path.join(tmpDir, 'matrix.csv');
    fs.writeFileSync(filePath, csvContent, 'utf-8');

    // Assert value map entries
});
```

### 7.3 Testing with Mocked findAllMatrixFiles

When testing functions that call `findAllMatrixFiles()` internally:

```javascript
import { findAllMatrixFiles } from '../../../src/io/util.js';

// In beforeEach or the test:
findAllMatrixFiles.mockReturnValue([
    { realm: 'EU05', matrixFile: path.join(tmpDir, 'EU05_matrix.csv') }
]);

// Then write the actual CSV file to tmpDir
fs.writeFileSync(
    path.join(tmpDir, 'EU05_matrix.csv'),
    csvContent,
    'utf-8'
);
```

---

## 8. Line Endings

**IMPORTANT:** All files must use LF line endings (not CRLF). After creating a test
file, verify line endings. ESLint will flag CRLF as errors.

Fix with PowerShell:
```powershell
$f = "tests/path/to/test.test.js"
$c = [System.IO.File]::ReadAllText($f)
[System.IO.File]::WriteAllText($f, $c.Replace("`r`n", "`n"))
```

---

## 9. Running Tests

```bash
# Run all tests
npx vitest run

# Run with coverage
npx vitest run --coverage

# Run specific file
npx vitest run tests/io/codeScanner.test.js

# Watch mode
npx vitest
```

---

## 10. Coverage Targets

Priority files for coverage expansion (highest value first):

| File | Current | Target | Why |
|------|---------|--------|-----|
| `src/io/codeScanner.js` | ~2% | 40%+ | Core P1-P5 classification pipeline |
| `src/helpers/analyzer.js` | 0% | 30%+ | Matrix processing orchestrator |
| `src/helpers/summarize.js` | ~35% | 50%+ | Preference normalization |
| `src/io/csv.js` | ~69% | 80%+ | CSV parsing foundation |
| `src/commands/preferences/helpers/preferenceRemoval.js` | ~67% | 80%+ | Deletion file loading |

---

## 11. Testing Command Files (Orchestrator Pattern)

Command files (`src/commands/<domain>/<domain>.js`) are orchestrators that wire together
prompts, helpers, and API calls. Their helpers are already tested in separate test files.
Follow these rules when testing command files:

### 11.1 Mock All Helpers, Verify Invocations

For functions already tested by helper test files, **do not re-test their logic**.
Instead, mock them and verify they are called with the correct arguments:

```javascript
// The helper is already tested in its own test file
vi.mock('../../../src/commands/meta/helpers/metaFileCleanup.js', () => ({
    buildMetaCleanupPlan: vi.fn(() => ({ actions: [], skipped: [] })),
    formatCleanupPlan: vi.fn(() => ''),
    // ...
}));

// In the test: verify the orchestrator calls the helper
it('calls buildMetaCleanupPlan with repo path and preference map', async () => {
    await triggerCommand();
    expect(buildMetaCleanupPlan).toHaveBeenCalledWith(
        '/mock/repo', expect.any(Map), expect.any(Array), expect.any(Object)
    );
});
```

### 11.2 Test Internal Output-Generating Functions

If the command file has private functions that format output, log summaries, or build
data structures, test those through the command flow:

```javascript
// Trigger a command and check that the internal function's console output appeared
it('logs per-realm deletion summary', async () => {
    setupMocksForRemoveFlow();
    await triggerRemovePreferences();
    expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Per-Realm Deletion Breakdown')
    );
});
```

### 11.3 Test Early-Exit Branches

Each command has guard clauses that exit early (no realms, no files, user cancels).
These are high-value tests because they verify graceful degradation:

```javascript
it('exits early when no realms are selected', async () => {
    resolveRealmScopeSelection.mockResolvedValue({ realmList: [] });
    await triggerCommand();
    expect(buildMetaCleanupPlan).not.toHaveBeenCalled();
});
```

### 11.4 Triggering Command Actions

Use Commander's `parseAsync` to trigger commands through their registered actions:

```javascript
async function triggerCommand(args = []) {
    const program = new Command();
    program.exitOverride();
    registerXxxCommands(program);
    await program.parseAsync(['node', 'test', 'command-name', ...args]);
}
```

### 11.5 What to Cover in Command Tests

| What | How | Priority |
|------|-----|----------|
| Registration (commands exist) | Assert `program.commands` after registration | Required |
| Happy-path flow | Mock helpers, verify call sequence and args | Required |
| Early exits (guard clauses) | Mock empty/null returns, verify no downstream calls | Required |
| User cancellation | Mock `inquirer.prompt` to return `confirm: false` | Required |
| Internal formatting functions | Trigger flow, check `console.log` calls | Nice to have |
| Error handling | Mock helper throws, verify graceful handling | Nice to have |

---

## 12. What NOT To Do

- **Never** make real API calls in tests
- **Never** read from the actual `results/` or `backup/` directories — copy formats into fixtures
- **Never** use `setTimeout` or timing-based assertions
- **Never** test console output content (mock it, don't assert it) — exception: command file tests may assert `console.log` was called with specific strings for internal formatting functions
- **Never** create test files with CRLF line endings
- **Never** re-test helper logic in command tests — only verify the helper was called
