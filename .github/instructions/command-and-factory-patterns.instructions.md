---
applyTo: "src/commands/**"
---
# Command Registration & Factory Patterns

Rules and conventions for command modules and reusable factory patterns in `src/commands/`.

---

## 1. Command Registration Pattern

Every command domain follows the same `register___Commands(program)` pattern:

### Directory Structure
```
src/commands/
├── <domain>/
│   ├── <domain>.js          ← registerXxxCommands(program) exported here
│   └── helpers/
│       ├── <helper>.js       ← Business logic, OCAPI calls, file I/O
│       └── ...
├── prompts/
│   ├── index.js              ← Re-exports all prompt functions
│   ├── commonPrompts.js      ← Shared prompts (instance type, confirmation)
│   ├── preferencePrompts.js  ← Preference-specific prompts
│   └── realmPrompts.js       ← Realm selection prompts
└── setup/
    ├── setup.js              ← registerSetupCommands(program)
    ├── blacklist.js          ← registerBlacklistCommands(program)
    ├── whitelist.js          ← registerWhitelistCommands(program)
    └── helpers/
        ├── blacklistHelper.js
        ├── whitelistHelper.js
        ├── blackAndWhiteListHelper.js  ← Shared factory
        └── listCommands.js             ← Shared factory
```

### Registration Convention

```javascript
// In src/commands/<domain>/<domain>.js
export function registerXxxCommands(program) {
    program
        .command('command-name')
        .description('What this command does')
        .action(async () => {
            // Command logic here
        });
}

// In src/main.js — registration order:
// 1. Setup commands (add-realm, remove-realm)
// 2. Blacklist commands (add-to-blacklist, remove-from-blacklist, list-blacklist)
// 3. Whitelist commands (add-to-whitelist, remove-from-whitelist, list-whitelist)
// 4. Cartridge commands (list-sites, validate-*)
// 5. Preference commands (analyze-preferences, remove-preferences, restore-*, backup-*)
// 6. Debug commands (test-*, debug-*)
```

### Rules

- **One registration function per domain file** — the `registerXxxCommands` function is the only export that touches `program`.
- **Business logic in helpers/** — command `.action()` handlers orchestrate the workflow by calling helpers, never contain raw OCAPI calls or file I/O directly.
- **Prompts in prompts/** — all `inquirer` prompts are extracted to `src/commands/prompts/` and re-exported via `index.js`.
- **Import helpers, not domains** — helpers never import from sibling domain files. Cross-domain reuse goes through `src/io/`, `src/config/`, or `src/helpers/`.
- **Each command has a comment block in main.js** — listing the command names, source location, and description.

---

## 2. Factory Pattern: `createListHelper()`

**File:** `src/commands/setup/helpers/blackAndWhiteListHelper.js`

A factory function that generates JSON-config CRUD operations for any list type. Used by both blacklistHelper.js and whitelistHelper.js to eliminate duplicate code.

### Factory Signature

```javascript
createListHelper({ listType, configFileName, filterMode })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `listType` | string | `'blacklist'` or `'whitelist'` — used in log messages |
| `configFileName` | string | JSON file name in `src/config/` (e.g., `'preference_blacklist.json'`) |
| `filterMode` | string | `'exclude'` (blacklist: matched → blocked) or `'include'` (whitelist: unmatched → blocked) |

### Returned Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `loadList` | `()` | Load JSON entries from config file |
| `saveList` | `(entries)` | Write entries back to config file |
| `isInList` | `(preferenceId, realm?)` | Check if a preference matches any entry |
| `filterByList` | `(preferences, realm?)` | Filter array based on `filterMode` |
| `addToList` | `(entry)` | Add pattern/exact entry |
| `removeFromList` | `(patternOrId)` | Remove entry by pattern/ID |
| `listEntries` | `()` | Return formatted entries array |

### Usage (thin wrapper pattern)

```javascript
// In blacklistHelper.js
import { createListHelper } from './blackAndWhiteListHelper.js';

const helpers = createListHelper({
    listType: 'blacklist',
    configFileName: 'preference_blacklist.json',
    filterMode: 'exclude'
});

export const loadBlacklist = helpers.loadList;
export const isBlacklisted = helpers.isInList;
// ... etc
```

### Entry Format

Each entry in the JSON config supports:
- `{ id: "c_exactMatch", type: "exact", reason: "..." }` — exact ID match
- `{ pattern: "c_adyen*", type: "wildcard", reason: "..." }` — glob-style wildcard
- `{ pattern: "^c_legacy.*", type: "regex", reason: "..." }` — regex match
- `{ ..., realms: ["EU05", "APAC"] }` — optional realm scoping

---

## 3. Factory Pattern: `createListCommands()`

**File:** `src/commands/setup/helpers/listCommands.js`

A factory function that generates Commander.js CLI commands (add, remove, list) for any list type. Used by both blacklist.js and whitelist.js.

### Factory Signature

```javascript
createListCommands({
    listName,        // 'blacklist' or 'whitelist'
    helpers,         // Object returned by createListHelper()
    descriptions,    // { add, remove, list } — command descriptions
    emptyMessage,    // Message when list is empty
    emptyHint,       // Hint shown after empty message
    headerTitle,     // Title for list display header
    wildcardExample, // Example wildcard pattern for prompts
    regexExample     // Example regex pattern for prompts
})
```

### Returned Value

```javascript
{ registerCommands: (program) => void }
```

### CLI commands generated

For `listName = 'blacklist'`:
- `add-to-blacklist` — interactive prompt to add exact/wildcard/regex pattern
- `remove-from-blacklist` — interactive prompt to select and remove entries
- `list-blacklist` — display all entries with type indicators

### Adding a new list type

To add a new list (e.g., `greylist`):
1. Create `src/config/preference_greylist.json` with `[]`
2. Create `src/commands/setup/helpers/greylistHelper.js` using `createListHelper()`
3. Create `src/commands/setup/greylist.js` using `createListCommands()`
4. Register in `src/main.js` with `registerGreylistCommands(program)`

---

## 4. Prompt Accessibility Rules

Prefer selection-based prompts over free-text prompts wherever possible.

### When to use each type

| Type | Use Case |
|------|----------|
| `list` | Choosing from known options (e.g., realms, tiers, groups) |
| `rawlist` | Choosing from numbered options |
| `confirm` | Yes/no decisions — **always** use this instead of asking the user to type "yes" or "no" |
| `checkbox` | Multi-selection from known options |
| `input` | Genuinely free-text values where the user may want to customize (e.g., branch name, commit message). **Always** provide a sensible `default` so the user can just press Enter. |

### Rules

1. **A 2-choice decision must never be `input`** — use `confirm` or `list`.
2. **When options can be fetched or derived**, use `list` or `checkbox` — never ask the user to type a value that could be selected from a known set.
3. **When a value can be accepted as a CLI argument** (e.g., `add-to-blacklist <pattern>`), prefer that over an interactive `input` prompt.
4. **Every `input` prompt must have a `default`** — the user should always be able to press Enter without typing.
5. **Never use `type: 'editor'`** for interactive prompts.

---

## 5. When Creating New Commands

1. Create the domain directory: `src/commands/<domain>/`
2. Create helpers subdirectory: `src/commands/<domain>/helpers/`
3. Create the main file with `export function register<Domain>Commands(program) { ... }`
4. Add a comment block and registration call in `src/main.js`
5. Extract any prompts to `src/commands/prompts/` and re-export via `index.js`
6. If the command shares CRUD logic with existing commands, use or extend the factory patterns above
