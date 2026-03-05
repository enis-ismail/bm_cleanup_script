/**
 * Preference Whitelist Helper
 * Manages an optional whitelist of preference IDs allowed for deletion workflows.
 * Thin wrapper over the shared createListHelper factory.
 *
 * @module whitelistHelper
 */

import { createListHelper } from './blackAndWhiteListHelper.js';

const helper = createListHelper({
    listType: 'whitelist',
    configFileName: 'preference_whitelist.json',
    filterMode: 'include'
});

/**
 * Load the whitelist configuration from disk.
 * @returns {Object} Parsed whitelist object with { description, whitelist: [] }
 */
export const loadWhitelist = helper.loadList;

/**
 * Save the whitelist configuration to disk.
 * @param {Object} config - Whitelist config object with { description, whitelist }
 */
export const saveWhitelist = helper.saveList;

/**
 * Check if a preference ID is whitelisted.
 * @param {string} preferenceId - The preference ID to check
 * @param {Array|null} [whitelistEntries] - Optional pre-loaded entries
 * @param {string|null} [realm] - Optional realm to scope the check
 * @returns {boolean} True if whitelisted
 */
export const isWhitelisted = helper.isInList;

/**
 * Filter an array of preference IDs, keeping only IDs that are whitelisted.
 * If no whitelist entries exist, all IDs are allowed.
 * @param {string[]} preferenceIds - Array of preference IDs to filter
 * @param {Array|null} [whitelistEntries] - Optional pre-loaded whitelist entries
 * @param {string|null} [realm] - Optional realm to scope the filter
 * @returns {{ allowed: string[], blocked: string[] }}
 */
export const filterWhitelisted = helper.filterByList;

/**
 * Add a new entry to the whitelist.
 * @param {Object} entry - Entry to add { pattern|id, type, reason, realms? }
 * @returns {boolean} True if added (false if duplicate)
 */
export const addToWhitelist = helper.addToList;

/**
 * Remove an entry from the whitelist by its pattern/id value.
 * @param {string} value - The pattern or ID to remove
 * @returns {boolean} True if removed (false if not found)
 */
export const removeFromWhitelist = helper.removeFromList;

/**
 * Get all whitelist entries for display.
 * @returns {Array<Object>} Array of whitelist entries
 */
export const listWhitelist = helper.listEntries;
