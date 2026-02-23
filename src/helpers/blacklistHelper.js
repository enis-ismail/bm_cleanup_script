/**
 * Preference Blacklist Helper
 * Manages a blacklist of preference IDs that should never be deleted.
 * Supports exact match, wildcard, and regex pattern types.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logError } from '../scripts/loggingScript/log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the absolute path to preference_blacklist.json in the project root
 * @returns {string} Absolute path to the blacklist file
 */
function getBlacklistPath() {
    return path.resolve(__dirname, '../../preference_blacklist.json');
}

/**
 * Load the blacklist configuration from disk
 * @returns {Object} Parsed blacklist object with { description, blacklist: [] }
 */
export function loadBlacklist() {
    const filePath = getBlacklistPath();

    if (!fs.existsSync(filePath)) {
        return { description: '', blacklist: [] };
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(raw);
        return {
            description: config.description || '',
            blacklist: Array.isArray(config.blacklist) ? config.blacklist : []
        };
    } catch (error) {
        logError(`Failed to parse preference_blacklist.json: ${error.message}`);
        return { description: '', blacklist: [] };
    }
}

/**
 * Save the blacklist configuration to disk
 * @param {Object} config - Blacklist config object with { description, blacklist }
 */
export function saveBlacklist(config) {
    const filePath = getBlacklistPath();
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Convert a wildcard pattern to a RegExp
 * Supports * (any characters) and ? (single character)
 * @param {string} pattern - Wildcard pattern
 * @returns {RegExp} Compiled regex
 * @private
 */
function wildcardToRegex(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars (except * and ?)
        .replace(/\*/g, '.*')                     // * → .*
        .replace(/\?/g, '.');                     // ? → .
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check whether a single preference ID matches a blacklist entry
 * @param {string} preferenceId - The preference ID to check
 * @param {Object} entry - A blacklist entry { pattern|id, type, reason }
 * @returns {boolean} True if the preference matches
 * @private
 */
function matchesEntry(preferenceId, entry) {
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
            logError(`Invalid regex in blacklist: ${entry.pattern}`);
            return false;
        }
    }

    return false;
}

/**
 * Check if a preference ID is blacklisted
 * @param {string} preferenceId - The preference ID to check
 * @param {Array} [blacklistEntries] - Optional pre-loaded entries (avoids re-reading file)
 * @returns {boolean} True if blacklisted
 */
export function isBlacklisted(preferenceId, blacklistEntries = null) {
    const entries = blacklistEntries || loadBlacklist().blacklist;
    return entries.some(entry => matchesEntry(preferenceId, entry));
}

/**
 * Filter an array of preference IDs, removing any that are blacklisted.
 * Returns both the filtered list and the set of blocked IDs.
 * @param {string[]} preferenceIds - Array of preference IDs to filter
 * @param {Array} [blacklistEntries] - Optional pre-loaded blacklist entries
 * @returns {{ allowed: string[], blocked: string[] }}
 */
export function filterBlacklisted(preferenceIds, blacklistEntries = null) {
    const entries = blacklistEntries || loadBlacklist().blacklist;

    if (entries.length === 0) {
        return { allowed: preferenceIds, blocked: [] };
    }

    const allowed = [];
    const blocked = [];

    for (const id of preferenceIds) {
        if (entries.some(entry => matchesEntry(id, entry))) {
            blocked.push(id);
        } else {
            allowed.push(id);
        }
    }

    return { allowed, blocked };
}

/**
 * Add a new entry to the blacklist
 * @param {Object} entry - Entry to add { pattern|id, type, reason }
 * @returns {boolean} True if added (false if duplicate)
 */
export function addToBlacklist(entry) {
    const config = loadBlacklist();
    const type = (entry.type || 'exact').toLowerCase();
    const key = type === 'exact' ? (entry.id || entry.pattern) : entry.pattern;

    // Check for duplicate
    const exists = config.blacklist.some(existing => {
        const existingType = (existing.type || 'exact').toLowerCase();
        const existingKey = existingType === 'exact'
            ? (existing.id || existing.pattern)
            : existing.pattern;
        return existingType === type && existingKey === key;
    });

    if (exists) {
        return false;
    }

    // Normalize entry shape
    const normalized = { type };
    if (type === 'exact') {
        normalized.id = key;
    } else {
        normalized.pattern = key;
    }
    if (entry.reason) {
        normalized.reason = entry.reason;
    }

    config.blacklist.push(normalized);
    saveBlacklist(config);
    return true;
}

/**
 * Remove an entry from the blacklist by its pattern/id value
 * @param {string} value - The pattern or ID to remove
 * @returns {boolean} True if removed (false if not found)
 */
export function removeFromBlacklist(value) {
    const config = loadBlacklist();
    const initialLength = config.blacklist.length;

    config.blacklist = config.blacklist.filter(entry => {
        const key = entry.type === 'exact'
            ? (entry.id || entry.pattern)
            : entry.pattern;
        return key !== value;
    });

    if (config.blacklist.length === initialLength) {
        return false;
    }

    saveBlacklist(config);
    return true;
}

/**
 * Get all blacklist entries for display
 * @returns {Array<Object>} Array of blacklist entries
 */
export function listBlacklist() {
    return loadBlacklist().blacklist;
}
