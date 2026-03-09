---
applyTo: "src/commands/**"
---
# Command File Structure

Rules for how `src/commands/<domain>/<domain>.js` files must be organized.
The reference implementation is `src/commands/preferences/preferences.js`.

---

## File Layout (top to bottom)

Every command file follows this exact section order:

```
1. Imports
2. Registration function (compact command index)
3. Command implementations (named functions, one per command)
4. Private helper functions (shared by commands in this file)
```

Each section is separated by a full-width comment banner:

```javascript
// ============================================================================
// SECTION TITLE
// ============================================================================
```

---

## 1. Imports

Standard import order (see refactoring.instructions.md § 7):

```javascript
// Node.js built-ins
import path from 'path';
import fs from 'fs';

// Third-party
import inquirer from 'inquirer';

// Internal — config/constants
import { LOG_PREFIX, IDENTIFIERS } from '../../config/constants.js';

// Internal — utilities/helpers
import { startTimer } from '../../helpers/timer.js';
import * as prompts from '../prompts/index.js';

// Internal — domain helpers
import { deletePreferencesForRealms } from './helpers/deleteHelpers.js';
```

---

## 2. Registration Function — The Command Index

The registration function is the **first thing after imports**. It must be
compact and scannable — a reader should see every command name and
description at a glance without scrolling.

### Rules

1. **One registration function per file**, named `register<Domain>Commands`.
2. **No logic inside `.action()`** — pass a named function reference.
3. If a command needs `options`, use a thin arrow wrapper that forwards them:
   `.action(async (options) => removePreferences(options))`
4. Keep each command entry to **2–5 lines** (command + description + options + action).
5. Add a section header comment above the registration function.

### Reference Pattern

```javascript
// ============================================================================
// <DOMAIN> COMMANDS REGISTRATION
// Register all <domain>-related commands with the CLI program
// ============================================================================

export function register<Domain>Commands(program) {
    program
        .command('analyze-preferences')
        .description('Full preference analysis workflow: fetch -> summarize -> check')
        .action(analyzePreferences);

    program
        .command('remove-preferences')
        .description('Remove preferences marked for deletion from site preferences')
        .option('--dry-run', 'Simulate deletion without making any changes')
        .action(async (options) => removePreferences(options));

    program
        .command('restore-preferences')
        .description('Restore site preferences from backup file')
        .action(restorePreferences);
}
```

### Anti-patterns (DO NOT)

```javascript
// ✗ BAD — inline logic makes the registration block unreadable
export function registerDebugCommands(program) {
    program
        .command('list-attribute-groups')
        .action(async () => {
            const realm = await inquirer.prompt(realmPrompt());
            // ... 40 lines of logic ...
        });
}

// ✗ BAD — anonymous function hides the command name
.action(async () => { /* hundreds of lines */ });
```

---

## 3. Command Implementations

Below the registration function, each command gets its own named `async function`
with a matching section header. The order matches the registration order.

### Rules

1. **One function per command** — the function name matches the command's purpose.
2. Each function has a **section header comment** with the command name and a
   one-line description.
3. Functions are **not exported** (they are private to this file, called only
   from the registration block).
4. Multi-step commands use numbered step comments (`// --- STEP 1: ... ---`).

### Pattern

```javascript
// ============================================================================
// ANALYZE PREFERENCES
// Full workflow: fetch -> summarize -> check usage in cartridges
// ============================================================================

async function analyzePreferences() {
    const timer = startTimer();

    // --- STEP 1: Configure Scope & Options ---
    logSectionTitle('STEP 1: Configure Scope & Options');
    // ...

    // --- STEP 2: Backup, Fetch & Summarize ---
    logSectionTitle('STEP 2: Backup, Fetch & Summarize Preferences');
    // ...
}

// ============================================================================
// REMOVE PREFERENCES
// Load deletion list -> backup -> delete -> optional restore
// ============================================================================

async function removePreferences(options = {}) {
    // ...
}
```

---

## 4. Private Helper Functions

Small focused functions shared between commands in the same file go at
the bottom, after all command implementations.

### Rules

1. Group under a single section header:
   ```javascript
   // ============================================================================
   // PRIVATE HELPER FUNCTIONS
   // Small focused functions that support the command workflows above
   // ============================================================================
   ```
2. Each helper has a JSDoc comment with `@param` / `@returns`.
3. Helpers are **not exported** — if another domain needs them, move to
   `src/commands/<domain>/helpers/` or `src/io/util.js`.

---

## Complete File Template

```javascript
import inquirer from 'inquirer';
import { startTimer } from '../../helpers/timer.js';
import * as prompts from '../prompts/index.js';
import { LOG_PREFIX } from '../../config/constants.js';
import { logSectionTitle, logRuntime } from '../../scripts/loggingScript/log.js';

// ============================================================================
// <DOMAIN> COMMANDS REGISTRATION
// Register all <domain>-related commands with the CLI program
// ============================================================================

export function register<Domain>Commands(program) {
    program
        .command('do-something')
        .description('Does something useful')
        .action(doSomething);

    program
        .command('do-another-thing')
        .description('Does another thing')
        .option('--dry-run', 'Preview without changes')
        .action(async (options) => doAnotherThing(options));
}

// ============================================================================
// DO SOMETHING
// One-line description of what this command does
// ============================================================================

async function doSomething() {
    const timer = startTimer();

    // --- STEP 1: ... ---
    logSectionTitle('STEP 1: ...');
    // ...

    logRuntime(timer);
}

// ============================================================================
// DO ANOTHER THING
// One-line description of what this command does
// ============================================================================

async function doAnotherThing(options = {}) {
    // ...
}

// ============================================================================
// PRIVATE HELPER FUNCTIONS
// Small focused functions that support the command workflows above
// ============================================================================

/**
 * Example helper function.
 * @param {string} input - Input value
 * @returns {string} Processed value
 */
function processInput(input) {
    return input.trim();
}
```

---

## When to Apply These Rules

| Scenario | Action |
|---|---|
| **Creating a new command file** | Follow the template above exactly |
| **Adding a command to an existing file** | Add a named function + entry in registration block |
| **Refactoring an existing file** | Extract inline `.action()` logic into named functions; reorder sections to match the layout |
| **Command logic exceeds ~80 lines** | Extract sub-steps into helpers in `<domain>/helpers/` |

---

## Existing Files & Compliance Status

| File | Status | Notes |
|---|---|---|
| `preferences/preferences.js` | **Reference** | Follows all rules — use as the model |
| `setup/setup.js` | Compliant | Small file, simple commands |
| `setup/blacklist.js` | Compliant | Uses factory pattern |
| `setup/whitelist.js` | Compliant | Uses factory pattern |
| `cartridges/cartridges.js` | Compliant | Registration at top, named function refs, helpers at bottom |
| `meta/meta.js` | Compliant | Registration at top, 2 named command functions, shared helpers extracted |
| `debug/debug.js` | Compliant | Registration at top, 14 named command functions, helpers at bottom |
