# Object Definitions

This directory contains typed object definitions used as function parameters
throughout the codebase.

## Purpose

When a function requires **4 or more parameters**, those parameters are grouped
into a named object with a factory function and JSDoc typedef. This keeps
function signatures readable and self-documenting.

## File Structure

Each file exports:
1. A `@typedef` JSDoc comment describing the object shape
2. A `create<Name>(input)` factory function that applies defaults and validates fields

## Example

```javascript
// src/objects/realmBackupOptions.js

/**
 * @typedef {Object} RealmBackupOptions
 * @property {string} realm - Realm name
 * @property {string} instanceType - Instance type
 * @property {string} objectType - SFCC object type
 * @property {string} backupDate - ISO date string
 */

export function createRealmBackupOptions(input = {}) {
    const {
        realm,
        instanceType,
        objectType = 'SitePreferences',
        backupDate = new Date().toISOString().split('T')[0]
    } = input;

    if (!realm) throw new Error('realm is required');
    if (!instanceType) throw new Error('instanceType is required');

    return { realm, instanceType, objectType, backupDate };
}
```

## Rules

- One object type per file
- File name in camelCase matching the object name
- Factory function is pure — no I/O, no side effects
- Use JSDoc `@typedef` so editors provide autocomplete
