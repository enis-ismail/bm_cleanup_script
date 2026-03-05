/**
 * Preference Blacklist Helper
 * Manages a blacklist of preference IDs that should never be deleted.
 * Thin wrapper over the shared createListHelper factory.
 *
 * @module blacklistHelper
 */

import { createListHelper } from './blackAndWhiteListHelper.js';

const helper = createListHelper({
    listType: 'blacklist',
    configFileName: 'preference_blacklist.json',
    filterMode: 'exclude'
});

/**
 * Load the blacklist configuration from disk.
 * @returns {Object} Parsed blacklist object with { description, blacklist: [] }
 */
export const loadBlacklist = helper.loadList;

/**
 * Save the blacklist configuration to disk.
 * @param {Object} config - Blacklist config object with { description, blacklist }
 */
export const saveBlacklist = helper.saveList;

/**
 * Check if a preference ID is blacklisted.
 * @param {string} preferenceId - The preference ID to check
 * @param {Array|null} [blacklistEntries] - Optional pre-loaded entries
 * @param {string|null} [realm] - Optional realm to scope the check
 * @returns {boolean} True if blacklisted
 */
export const isBlacklisted = helper.isInList;

/**
 * Filter an array of preference IDs, removing any that are blacklisted.
 * Returns both the filtered list and the set of blocked IDs.
 * @param {string[]} preferenceIds - Array of preference IDs to filter
 * @param {Array|null} [blacklistEntries] - Optional pre-loaded blacklist entries
 * @param {string|null} [realm] - Optional realm to scope the filter
 * @returns {{ allowed: string[], blocked: string[] }}
 */
export const filterBlacklisted = helper.filterByList;

/**
 * Add a new entry to the blacklist.
 * @param {Object} entry - Entry to add { pattern|id, type, reason, realms? }
 * @returns {boolean} True if added (false if duplicate)
 */
export const addToBlacklist = helper.addToList;

/**
 * Remove an entry from the blacklist by its pattern/id value.
 * @param {string} value - The pattern or ID to remove
 * @returns {boolean} True if removed (false if not found)
 */
export const removeFromBlacklist = helper.removeFromList;

/**
 * Get all blacklist entries for display.
 * @returns {Array<Object>} Array of blacklist entries
 */
export const listBlacklist = helper.listEntries;
