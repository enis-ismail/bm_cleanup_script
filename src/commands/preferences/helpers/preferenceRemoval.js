/**
 * Preference Removal Helper
 * Handles loading and removing site preferences marked for deletion
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { ensureResultsDir } from '../../../helpers/util.js';

/**
 * Load preferences marked for deletion from file
 * @param {string} instanceType - Instance type (sandbox, development, staging, production)
 * @returns {Array<string>|null} Array of preference IDs or null if file doesn't exist
 */
export function loadPreferencesForDeletion(instanceType) {
    const resultsDir = ensureResultsDir('ALL_REALMS', instanceType);
    const filePath = path.join(resultsDir, `${instanceType}_preferences_for_deletion.txt`);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const preferences = [];
    let inPreferenceSection = false;

    for (const line of lines) {
        if (line.trim() === '--- Preferences for Deletion ---') {
            inPreferenceSection = true;
            continue;
        }

        if (inPreferenceSection && line.trim()) {
            preferences.push(line.trim());
        }
    }

    return preferences.length > 0 ? preferences : null;
}

/**
 * Open preferences for deletion file in VS Code editor
 * @param {string} instanceType - Instance type (sandbox, development, staging, production)
 * @returns {Promise<string>} Path to the opened file
 */
export async function openPreferencesForDeletionInEditor(instanceType) {
    const resultsDir = ensureResultsDir('ALL_REALMS', instanceType);
    const filePath = path.join(resultsDir, `${instanceType}_preferences_for_deletion.txt`);

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
