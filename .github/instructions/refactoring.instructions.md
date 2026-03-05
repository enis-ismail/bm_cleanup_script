---
applyTo: "**"
---
# Refactoring & Code Quality Rules

This document defines mandatory rules for refactoring and writing new code in this project.
These rules supplement the ESLint configuration in `eslint.config.js` and the code quality
standards in `AGENTS.md`.

---

## 1. Eliminate Duplicate Code

When refactoring or writing new code:

- **Identify repeated logic** across functions, files, or modules. If the same block of code
  (≥3 lines or a distinct logical unit) appears more than once, extract it into a shared function.
- **Place extracted functions** in the most relevant helper file:
  - General utilities → `src/io/util.js`
  - Logging helpers → `src/scripts/loggingScript/log.js`
  - API-related → `src/api/api.js`
  - Config helpers → `src/config/helpers/helpers.js`
  - Command-specific shared logic → `src/commands/<category>/helpers/<relevant>Helper.js`
- **Name extracted functions** descriptively — the name should explain *what* it does, not *how*.
- When a block is duplicated across unrelated modules, prefer a new utility function in
  `src/io/util.js` or a new helper file rather than creating cross-module dependencies.

---

## 2. Function Parameter Limits

Function signatures must stay readable. Apply these rules strictly:

| Parameter Count | Action |
|---|---|
| **1–3 params** | Acceptable — use positional parameters |
| **4+ params** | **Must** use a single options object with destructuring |

### When a function exceeds 3 parameters

1. **Prompt the user** with the current parameter list and ask for an **object name**
   to group them under (e.g., `RealmDeletionOptions`, `BackupConfig`).
2. Once the name is provided, **create an object definition file** at
   `src/objects/<ObjectName>.js` (see [Object File Structure](#object-file-structure) below).
3. **Refactor the function signature** to accept the named object with destructuring:
   ```javascript
   // BEFORE (too many params)
   function createBackup(realm, instanceType, objectType, filePath, date, overwrite) { ... }

   // AFTER (object parameter)
   function createBackup({ realm, instanceType, objectType, filePath, date, overwrite }) { ... }
   ```
4. Update all call sites to pass an object literal.

### Object File Structure

Object definition files live in `src/objects/` and follow this template:

```javascript
/**
 * @typedef {Object} <ObjectName>
 * @property {<type>} <property> - <description>
 * ...
 */

/**
 * Create a validated <ObjectName> instance.
 * @param {Partial<<ObjectName>>} input - Raw input values
 * @returns {<ObjectName>} Validated object
 */
export function create<ObjectName>(input = {}) {
    const {
        propertyA = <default>,
        propertyB = <default>,
        ...
    } = input;

    return { propertyA, propertyB, ... };
}
```

**Rules for object files:**
- One object type per file
- File name matches the object name in camelCase (e.g., `realmDeletionOptions.js`)
- Export the `@typedef` JSDoc comment so other files can reference it
- Export a factory function (`create<Name>`) that applies defaults and validates required fields
- Keep the factory pure — no side effects, no I/O

### Existing patterns to follow

The codebase already uses object destructuring in function signatures. Match these conventions:

```javascript
// ✓ Good — object param with destructured defaults
export async function deletePreferencesForRealms({ realmPreferenceMap, objectType, dryRun = false }) { ... }

// ✓ Good — object param with JSDoc
/**
 * @param {Object} options
 * @param {string} options.realm - Realm name
 * @param {Object} options.backup - Loaded backup object
 */
export async function restorePreference({ realm, backup, objectType, instanceType }) { ... }

// ✗ Bad — too many positional params
function processData(realm, instanceType, objectType, filePath, overwrite, dryRun) { ... }
```

---

## 3. Variable Declarations

(Carried forward from AGENTS.md — these remain in effect)

- Declare variables at the **top of the function** with their assigned values immediately
- Use `const` for values that won't change; `let` only for conditionally-assigned variables
- Never declare empty `const` or `let` when the value is available at declaration time

---

## 4. JSDoc on Every Exported Function

Every exported function **must** have a JSDoc comment with:
- `@param` for each parameter (including object property types)
- `@returns` with the return type
- A one-line description of what the function does

```javascript
/**
 * Load per-realm preferences for deletion.
 * @param {string} realm - Realm name (e.g. 'EU05')
 * @param {string} instanceType - Instance type
 * @param {Object} [options] - Filtering options
 * @param {string} [options.maxTier] - Maximum tier to include
 * @returns {{ allowed: Array | null, blocked: string[] }} Filtered preferences
 */
```

Private/internal helper functions should use `@private` tag.

---

## 5. Single Responsibility

- Each function should do **one thing**. If a function name requires "and" to describe it,
  split it into two functions.
- Each file should own **one area of concern**. If a helper file grows beyond ~400 lines,
  evaluate whether it should be split.

---

## 6. Consistent Error Handling

Follow the established patterns:

```javascript
// For I/O operations — try/catch with descriptive error
try {
    fs.writeFileSync(filePath, content, 'utf-8');
} catch (error) {
    logError(`Failed to write ${filePath}: ${error.message}`);
    throw error;
}

// For API calls — let errors propagate unless specific handling needed
// For optional operations — catch and log warning, continue
```

---

## 7. Import Organization

Imports must be ordered in groups (separated by a blank line):

1. **Node.js built-ins** — `fs`, `path`, `child_process`
2. **Third-party modules** — `inquirer`, `commander`
3. **Internal modules** — project imports, grouped by proximity:
   - Config/constants first
   - Utilities/helpers next
   - Sibling/local imports last

---

## 8. Constants Over Magic Values

- Never use string literals or numbers with special meaning inline in logic.
  Move them to `src/config/constants.js` and give them a descriptive name.
- Existing patterns: `LOG_PREFIX`, `FILE_PATTERNS`, `TIER_ORDER`, `API_CONFIG`, `SCAN_CONFIG`

---

## 9. Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Files | camelCase | `backupHelpers.js` |
| Functions | camelCase, verb-first | `loadRealmPreferences()` |
| Constants (exported objects) | UPPER_SNAKE_CASE | `FILE_PATTERNS` |
| Object type definitions | PascalCase | `RealmDeletionOptions` |
| Boolean variables | `is`/`has`/`should` prefix | `isBlacklisted`, `hasValues` |
| Private/unused params | `_` prefix | `_realm`, `_index` |

---

## 10. Line Length & String Concatenation

- Max line length: **120 characters** (ESLint enforced as warning)
- For long strings, use concatenation with `+` on the next line, indented to align:
  ```javascript
  console.log(
      `${LOG_PREFIX.WARNING} Per-realm deletion files not found for:`
      + ` ${perRealmResult.missingRealms.join(', ')}`
  );
  ```
- Use template literals only when interpolation is needed. Plain strings use single quotes.

---

## Refactoring Checklist

When performing a refactoring pass, work through these steps in order:

1. **Scan for duplicates** — grep for repeated blocks across files in scope
2. **Check parameter counts** — flag any function with 4+ positional params
3. **Verify JSDoc** — every export must have param/return docs
4. **Validate naming** — functions, files, constants follow conventions above
5. **Check constants** — no magic strings/numbers in logic
6. **Run ESLint** — `npx eslint src/` must pass with zero errors
7. **Update AGENTS.md** — if new helpers or patterns were introduced
