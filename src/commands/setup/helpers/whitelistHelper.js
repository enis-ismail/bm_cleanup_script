/**
 * Preference Whitelist Helper
 * Manages an optional whitelist of preference IDs that are allowed for deletion workflows.
 * Supports exact match, wildcard, and regex pattern types.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logError } from '../../../scripts/loggingScript/log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the absolute path to src/config/preference_whitelist.json
 * @returns {string} Absolute path to the whitelist file
 */
function getWhitelistPath() {
    return path.resolve(__dirname, '../../../config/preference_whitelist.json');
}

/**
 * Load the whitelist configuration from disk
 * @returns {Object} Parsed whitelist object with { description, whitelist: [] }
 */
export function loadWhitelist() {
    const filePath = getWhitelistPath();

    if (!fs.existsSync(filePath)) {
        return { description: '', whitelist: [] };
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(raw);
        return {
            description: config.description || '',
            whitelist: Array.isArray(config.whitelist) ? config.whitelist : []
        };
    } catch (error) {
        logError(`Failed to parse src/config/preference_whitelist.json: ${error.message}`);
        return { description: '', whitelist: [] };
    }
}

/**
 * Save the whitelist configuration to disk
 * @param {Object} config - Whitelist config object with { description, whitelist }
 */
export function saveWhitelist(config) {
    const filePath = getWhitelistPath();
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
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check whether a single preference ID matches a whitelist entry
 * @param {string} preferenceId - The preference ID to check
 * @param {Object} entry - A whitelist entry { pattern|id, type, reason }
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
            logError(`Invalid regex in whitelist: ${entry.pattern}`);
            return false;
        }
    }

    return false;
}

/**
 * Check if a preference ID is whitelisted
 * @param {string} preferenceId - The preference ID to check
 * @param {Array} [whitelistEntries] - Optional pre-loaded entries (avoids re-reading file)
 * @returns {boolean} True if whitelisted
 */
export function isWhitelisted(preferenceId, whitelistEntries = null) {
    const entries = whitelistEntries || loadWhitelist().whitelist;
    return entries.some(entry => matchesEntry(preferenceId, entry));
}

/**
 * Filter an array of preference IDs, keeping only IDs that are whitelisted.
 * If no whitelist entries exist, all IDs are allowed.
 * @param {string[]} preferenceIds - Array of preference IDs to filter
 * @param {Array} [whitelistEntries] - Optional pre-loaded whitelist entries
 * @returns {{ allowed: string[], blocked: string[] }}
 */
export function filterWhitelisted(preferenceIds, whitelistEntries = null) {
    const entries = whitelistEntries || loadWhitelist().whitelist;

    if (entries.length === 0) {
        return { allowed: preferenceIds, blocked: [] };
    }

    const allowed = [];
    const blocked = [];

    for (const id of preferenceIds) {
        if (entries.some(entry => matchesEntry(id, entry))) {
            allowed.push(id);
        } else {
            blocked.push(id);
        }
    }

    return { allowed, blocked };
}

/**
 * Add a new entry to the whitelist
 * @param {Object} entry - Entry to add { pattern|id, type, reason }
 * @returns {boolean} True if added (false if duplicate)
 */
export function addToWhitelist(entry) {
    const config = loadWhitelist();
    const type = (entry.type || 'exact').toLowerCase();
    const key = type === 'exact' ? (entry.id || entry.pattern) : entry.pattern;

    const exists = config.whitelist.some(existing => {
        const existingType = (existing.type || 'exact').toLowerCase();
        const existingKey = existingType === 'exact'
            ? (existing.id || existing.pattern)
            : existing.pattern;
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

    config.whitelist.push(normalized);
    saveWhitelist(config);
    return true;
}

/**
 * Remove an entry from the whitelist by its pattern/id value
 * @param {string} value - The pattern or ID to remove
 * @returns {boolean} True if removed (false if not found)
 */
export function removeFromWhitelist(value) {
    const config = loadWhitelist();
    const initialLength = config.whitelist.length;

    config.whitelist = config.whitelist.filter(entry => {
        const key = entry.type === 'exact'
            ? (entry.id || entry.pattern)
            : entry.pattern;
        return key !== value;
    });

    if (config.whitelist.length === initialLength) {
        return false;
    }

    saveWhitelist(config);
    return true;
}

/**
 * Get all whitelist entries for display
 * @returns {Array<Object>} Array of whitelist entries
 */
export function listWhitelist() {
    return loadWhitelist().whitelist;
}
