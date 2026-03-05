/**
 * Shared Black/White List Helper Factory
 * Generates list management functions for either a blacklist or whitelist.
 * Eliminates duplication between blacklistHelper.js and whitelistHelper.js.
 *
 * @module blackAndWhiteListHelper
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logError } from '../../../scripts/loggingScript/log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Convert a wildcard pattern to a RegExp.
 * Supports * (any characters) and ? (single character).
 * @param {string} pattern - Wildcard pattern
 * @returns {RegExp} Compiled regex
 * @private
 */
function wildcardToRegex(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check whether a single preference ID matches a list entry.
 * If the entry has a `realms` array and a `realm` is provided, the entry
 * only matches when the realm is included in the array. Entries without
 * `realms` (or with an empty array) apply to all realms.
 *
 * @param {string} preferenceId - The preference ID to check
 * @param {Object} entry - A list entry { pattern|id, type, reason, realms? }
 * @param {string} listType - 'blacklist' or 'whitelist' (for error messages)
 * @param {string|null} [realm] - Optional realm to scope the check
 * @returns {boolean} True if the preference matches
 * @private
 */
function matchesEntry(preferenceId, entry, listType, realm = null) {
    if (Array.isArray(entry.realms) && entry.realms.length > 0) {
        if (!realm || !entry.realms.includes(realm)) {
            return false;
        }
    }

    const type = (entry.type || 'exact').toLowerCase();

    if (type === 'exact') {
        const id = entry.id || entry.pattern || '';
        return preferenceId === id;
    }

    if (type === 'wildcard') {
        const regex = wildcardToRegex(entry.pattern || '');
        return regex.test(preferenceId);
    }

    if (type === 'regex') {
        try {
            const regex = new RegExp(entry.pattern, 'i');
            return regex.test(preferenceId);
        } catch {
            logError(`Invalid regex in ${listType}: ${entry.pattern}`);
            return false;
        }
    }

    return false;
}

/**
 * Resolve the key used to extract the entry from a list entry object.
 * @param {Object} entry - A list entry
 * @returns {string} The pattern or ID value
 * @private
 */
function getEntryKey(entry) {
    const type = (entry.type || 'exact').toLowerCase();
    return type === 'exact'
        ? (entry.id || entry.pattern)
        : entry.pattern;
}

/**
 * Create a full set of list management functions for a given list type.
 *
 * @param {Object} options - Factory configuration
 * @param {string} options.listType - 'blacklist' or 'whitelist'
 * @param {string} options.configFileName - JSON file name (e.g. 'preference_blacklist.json')
 * @param {string} options.filterMode - 'exclude' (matched → blocked) or 'include' (unmatched → blocked)
 * @returns {Object} Object with loadList, saveList, isInList, filterByList, addToList, removeFromList, listEntries
 */
export function createListHelper({ listType, configFileName, filterMode }) {

    /**
     * Resolve the absolute path to the config file in src/config/.
     * @returns {string} Absolute path
     */
    function getListPath() {
        return path.resolve(__dirname, `../../../config/${configFileName}`);
    }

    /**
     * Load the list configuration from disk.
     * @returns {Object} Parsed config with { description, [listType]: [] }
     */
    function loadList() {
        const filePath = getListPath();

        if (!fs.existsSync(filePath)) {
            return { description: '', [listType]: [] };
        }

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const config = JSON.parse(raw);
            return {
                description: config.description || '',
                [listType]: Array.isArray(config[listType]) ? config[listType] : []
            };
        } catch (error) {
            logError(`Failed to parse src/config/${configFileName}: ${error.message}`);
            return { description: '', [listType]: [] };
        }
    }

    /**
     * Save the list configuration to disk.
     * @param {Object} config - Config object with { description, [listType] }
     */
    function saveList(config) {
        const filePath = getListPath();
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }

    /**
     * Check if a preference ID is in the list.
     * @param {string} preferenceId - The preference ID to check
     * @param {Array|null} [entries] - Optional pre-loaded entries
     * @param {string|null} [realm] - Optional realm to scope the check
     * @returns {boolean} True if the preference matches an entry
     */
    function isInList(preferenceId, entries = null, realm = null) {
        const resolved = entries || loadList()[listType];
        return resolved.some(entry => matchesEntry(preferenceId, entry, listType, realm));
    }

    /**
     * Filter an array of preference IDs based on the list.
     *
     * - filterMode 'exclude' (blacklist): matched IDs → blocked, rest → allowed.
     * - filterMode 'include' (whitelist): unmatched IDs → blocked, matched → allowed.
     *   If the list is empty, all IDs are allowed (passthrough).
     *
     * @param {string[]} preferenceIds - Array of preference IDs to filter
     * @param {Array|null} [listEntries] - Optional pre-loaded entries
     * @param {string|null} [realm] - Optional realm to scope the filter
     * @returns {{ allowed: string[], blocked: string[] }}
     */
    function filterByList(preferenceIds, listEntries = null, realm = null) {
        const entries = listEntries || loadList()[listType];

        if (entries.length === 0) {
            return { allowed: preferenceIds, blocked: [] };
        }

        const allowed = [];
        const blocked = [];

        for (const id of preferenceIds) {
            const isMatch = entries.some(
                entry => matchesEntry(id, entry, listType, realm)
            );

            if (filterMode === 'exclude') {
                // Blacklist: matched → blocked
                if (isMatch) {
                    blocked.push(id);
                } else {
                    allowed.push(id);
                }
            } else {
                // Whitelist: unmatched → blocked
                if (isMatch) {
                    allowed.push(id);
                } else {
                    blocked.push(id);
                }
            }
        }

        return { allowed, blocked };
    }

    /**
     * Add a new entry to the list.
     * @param {Object} entry - Entry to add { pattern|id, type, reason, realms? }
     * @returns {boolean} True if added (false if duplicate)
     */
    function addToList(entry) {
        const config = loadList();
        const type = (entry.type || 'exact').toLowerCase();
        const key = type === 'exact' ? (entry.id || entry.pattern) : entry.pattern;

        const exists = config[listType].some(existing => {
            const existingType = (existing.type || 'exact').toLowerCase();
            const existingKey = getEntryKey(existing);
            return existingType === type && existingKey === key;
        });

        if (exists) {
            return false;
        }

        const normalized = { type };
        if (type === 'exact') {
            normalized.id = key;
        } else {
            normalized.pattern = key;
        }
        if (entry.reason) {
            normalized.reason = entry.reason;
        }
        if (Array.isArray(entry.realms) && entry.realms.length > 0) {
            normalized.realms = entry.realms;
        }

        config[listType].push(normalized);
        saveList(config);
        return true;
    }

    /**
     * Remove an entry from the list by its pattern/id value.
     * @param {string} value - The pattern or ID to remove
     * @returns {boolean} True if removed (false if not found)
     */
    function removeFromList(value) {
        const config = loadList();
        const initialLength = config[listType].length;

        config[listType] = config[listType].filter(entry => getEntryKey(entry) !== value);

        if (config[listType].length === initialLength) {
            return false;
        }

        saveList(config);
        return true;
    }

    /**
     * Get all list entries for display.
     * @returns {Array<Object>} Array of list entries
     */
    function listEntries() {
        return loadList()[listType];
    }

    return {
        loadList,
        saveList,
        isInList,
        filterByList,
        addToList,
        removeFromList,
        listEntries
    };
}
