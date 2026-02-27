/**
 * Preference Removal Helper
 * Handles loading and removing site preferences marked for deletion
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { ensureResultsDir } from '../../../io/util.js';
import { IDENTIFIERS, FILE_PATTERNS, REALM_TAGS } from '../../../config/constants.js';
import { filterBlacklisted } from '../../setup/helpers/blacklistHelper.js';
import { filterWhitelisted } from '../../setup/helpers/whitelistHelper.js';

/**
 * Load preferences marked for deletion from file.
 * Parses realm tags from each preference line (e.g., "realms: ALL" or "realms: EU05, GB").
 * @param {string} instanceType - Instance type (sandbox, development, staging, production)
 * @returns {{
 *   allowed: Array<{id: string, realms: string[]}> | null,
 *   blocked: string[],
 *   skippedByWhitelist: string[]
 * } | null}
 */
export function loadPreferencesForDeletion(instanceType) {
    const resultsDir = ensureResultsDir(IDENTIFIERS.ALL_REALMS, instanceType);
    const filePath = path.join(resultsDir, `${instanceType}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const preferences = [];
    let inPreferenceSection = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Detect any priority section header: --- [P1] ..., --- [P2] ..., etc.
        // Also support legacy format: --- Preferences for Deletion ---
        if (trimmed.startsWith('--- [P') || trimmed === '--- Preferences for Deletion ---') {
            inPreferenceSection = true;
            continue;
        }

        // Stop parsing at the blacklisted section
        if (trimmed === '--- Blacklisted Preferences (Protected) ---') {
            break;
        }

        // Skip separator lines and empty lines
        if (!trimmed || trimmed.startsWith('=')) {
            // A separator between sections doesn't stop parsing — it may be followed
            // by another [P*] section header
            if (trimmed.startsWith('=')) {
                inPreferenceSection = false;
            }
            continue;
        }

        if (inPreferenceSection) {
            // Split on metadata separator "  |  "
            const parts = trimmed.split('  |  ');
            const prefId = parts[0].trim();

            if (!prefId) {
                continue;
            }

            // Extract realm tags from metadata parts
            let realms = [REALM_TAGS.ALL];
            for (const part of parts.slice(1)) {
                const realmMatch = part.trim().match(/^realms:\s*(.+)$/i);
                if (realmMatch) {
                    const realmStr = realmMatch[1].trim();
                    realms = realmStr === REALM_TAGS.ALL
                        ? [REALM_TAGS.ALL]
                        : realmStr.split(',').map(r => r.trim()).filter(Boolean);
                    break;
                }
            }

            preferences.push({ id: prefId, realms });
        }
    }

    if (preferences.length === 0) {
        return null;
    }

    // Safety nets: apply whitelist first (if active), then blacklist
    const allIds = preferences.map(p => p.id);
    const { allowed: whitelistedIds, blocked: skippedByWhitelist } = filterWhitelisted(allIds);
    const { allowed: allowedIds, blocked } = filterBlacklisted(whitelistedIds);

    if (allowedIds.length === 0) {
        return { allowed: null, blocked, skippedByWhitelist };
    }

    const allowedSet = new Set(allowedIds);
    const allowed = preferences.filter(p => allowedSet.has(p.id));

    return { allowed, blocked, skippedByWhitelist };
}

/**
 * Build a per-realm preference map from loaded preference data and selected realms.
 * Maps each selected realm to the list of preference IDs that should be deleted from it.
 * @param {Array<{id: string, realms: string[]}>} preferenceData - Realm-tagged preference data
 * @param {string[]} selectedRealms - Realms selected by the user for deletion
 * @returns {Map<string, string[]>} Map of realm → preference IDs to delete from that realm
 */
export function buildRealmPreferenceMap(preferenceData, selectedRealms) {
    const realmMap = new Map();

    for (const realm of selectedRealms) {
        realmMap.set(realm, []);
    }

    for (const { id, realms } of preferenceData) {
        const isAllRealms = realms.length === 1 && realms[0] === REALM_TAGS.ALL;

        for (const realm of selectedRealms) {
            if (isAllRealms || realms.includes(realm)) {
                realmMap.get(realm).push(id);
            }
        }
    }

    return realmMap;
}

/**
 * Open preferences for deletion file in VS Code editor
 * @param {string} instanceType - Instance type (sandbox, development, staging, production)
 * @returns {Promise<string>} Path to the opened file
 */
export async function openPreferencesForDeletionInEditor(instanceType) {
    const resultsDir = ensureResultsDir(IDENTIFIERS.ALL_REALMS, instanceType);
    const filePath = path.join(resultsDir, `${instanceType}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`);

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    return new Promise((resolve, reject) => {
        exec(`code "${filePath}"`, (error) => {
            if (error) {
                reject(new Error(`Failed to open file in VS Code: ${error.message}`));
            } else {
                resolve(filePath);
            }
        });
    });
}

/**
 * Display preferences for deletion with summary
 * @param {Array<string>} preferences - Array of preference IDs
 */
export function displayPreferencesForDeletion(preferences) {
    console.log('\n================================================================================');
    console.log('PREFERENCES MARKED FOR DELETION');
    console.log('================================================================================\n');

    console.log(`Total preferences to delete: ${preferences.length}\n`);
    console.log('Preferences:\n');

    // Show preferences in groups of 10 for readability
    for (let i = 0; i < preferences.length; i += 10) {
        const batch = preferences.slice(i, i + 10);
        batch.forEach((pref, idx) => {
            const number = i + idx + 1;
            console.log(`  ${number.toString().padStart(4, '0')}. ${pref}`);
        });
        if (i + 10 < preferences.length) {
            console.log('');
        }
    }

    console.log('\n================================================================================\n');
}

/**
 * Generate summary statistics for preferences to be deleted
 * @param {Array<string>} preferences - Array of preference IDs
 * @returns {Object} Summary statistics
 */
export function generateDeletionSummary(preferences) {
    // Group by prefix to show what types of preferences are being removed
    const prefixMap = new Map();

    for (const pref of preferences) {
        // Extract prefix (text before first uppercase letter after first char)
        let prefix = pref[0];
        for (let i = 1; i < pref.length; i++) {
            if (pref[i] === pref[i].toUpperCase() && pref[i] !== '_') {
                break;
            }
            prefix += pref[i];
        }

        if (!prefixMap.has(prefix)) {
            prefixMap.set(prefix, 0);
        }
        prefixMap.set(prefix, prefixMap.get(prefix) + 1);
    }

    // Sort by count descending
    const sortedPrefixes = Array.from(prefixMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Top 10 prefixes

    return {
        total: preferences.length,
        topPrefixes: sortedPrefixes
    };
}
