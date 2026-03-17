/**
 * Preference Inspection Helper
 * Reads pre-generated results files to display comprehensive data
 * about a single preference. No OCAPI calls or live code scanning.
 */

import fs from 'fs';
import path from 'path';
import { getResultsPath, ensureResultsDir, findAllUsageFiles } from '../../../io/util.js';
import { parseCSVToNestedArray } from '../../../io/csv.js';
import {
    FILE_PATTERNS, IDENTIFIERS, TIER_DESCRIPTIONS
} from '../../../config/constants.js';

/**
 * Output filename for the inspect-preference report.
 * This file is reused (overwritten) on each invocation.
 */
const INSPECT_OUTPUT_FILE = 'preference_inspection.txt';

/**
 * Parse the per-realm deletion file and return the tier for a specific preference.
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @param {string} preferenceId - Preference ID to look up
 * @returns {string|null} Tier label (e.g. 'P1') or null if not found
 */
function getTierFromDeletionFile(realm, instanceType, preferenceId) {
    const realmDir = getResultsPath(realm, instanceType);
    const filePath = path.join(realmDir, `${realm}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    let currentTier = null;

    for (const line of lines) {
        const trimmed = line.trim();

        const tierMatch = trimmed.match(/^---\s*\[P(\d)\]/);
        if (tierMatch) {
            currentTier = `P${tierMatch[1]}`;
            continue;
        }

        if (trimmed.startsWith('=')) {
            currentTier = null;
            continue;
        }

        if (currentTier && trimmed) {
            const parts = trimmed.split('  |  ');
            const id = parts[0].trim();
            if (id === preferenceId) {
                return currentTier;
            }
        }
    }

    return null;
}

/**
 * Extract per-site values for a preference from a usage CSV file.
 * @param {string} usageFilePath - Path to usage CSV
 * @param {string} preferenceId - Preference ID to look up
 * @returns {{ groupId: string, defaultValue: string, description: string, type: string, siteValues: Object }|null}
 */
function extractPreferenceFromUsageCSV(usageFilePath, preferenceId) {
    const csvData = parseCSVToNestedArray(usageFilePath);

    if (csvData.length <= 1) {
        return null;
    }

    const headers = csvData[0];
    const prefIdIndex = headers.indexOf('preferenceId');
    const defaultValueIndex = headers.indexOf('defaultValue');
    const descriptionIndex = headers.indexOf('description');
    const typeIndex = headers.indexOf('type');
    const groupIdIndex = headers.indexOf('groupId');

    if (prefIdIndex === -1) {
        return null;
    }

    for (let i = 1; i < csvData.length; i++) {
        const row = csvData[i];
        if (row[prefIdIndex] !== preferenceId) {
            continue;
        }

        const siteValues = {};
        for (let col = 0; col < headers.length; col++) {
            if (headers[col].startsWith('value_')) {
                const siteName = headers[col].replace('value_', '');
                const value = row[col] || '';
                if (value) {
                    siteValues[siteName] = value;
                }
            }
        }

        return {
            groupId: groupIdIndex !== -1 ? (row[groupIdIndex] || '') : '',
            defaultValue: defaultValueIndex !== -1 ? (row[defaultValueIndex] || '') : '',
            description: descriptionIndex !== -1 ? (row[descriptionIndex] || '') : '',
            type: typeIndex !== -1 ? (row[typeIndex] || '') : '',
            siteValues
        };
    }

    return null;
}

/**
 * Load code references for a preference from the pre-generated references JSON.
 * @param {string} instanceType - Instance type
 * @param {string} preferenceId - Preference ID to look up
 * @returns {{ references: Array<{file: string, line: number, text: string, cartridge: string|null}>, cartridges: string[] }|null}
 *   null if the references file doesn't exist
 */
function loadCodeReferences(instanceType, preferenceId) {
    const dirName = instanceType || IDENTIFIERS.ALL_REALMS;
    const resultsDir = getResultsPath(IDENTIFIERS.ALL_REALMS, instanceType);
    const filePath = path.join(
        resultsDir, `${dirName}${FILE_PATTERNS.PREFERENCE_REFERENCES}`
    );

    if (!fs.existsSync(filePath)) {
        return null;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const refs = data.preferences?.[preferenceId] || [];
    const cartridges = [...new Set(
        refs.map(r => r.cartridge).filter(Boolean)
    )].sort();

    return { references: refs, cartridges };
}

/**
 * Build the full inspection report for a single preference using results files only.
 *
 * @param {Object} params
 * @param {string} params.preferenceId - Preference ID
 * @param {string} params.instanceType - Instance type
 * @param {string[]} params.realms - Realms to inspect
 * @returns {string} Formatted report text
 */
export function buildInspectionReport({ preferenceId, instanceType, realms }) {
    const lines = [];
    const separator = '='.repeat(80);
    const thinSeparator = '-'.repeat(80);

    lines.push(separator);
    lines.push(`  PREFERENCE INSPECTION: ${preferenceId}`);
    lines.push(separator);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Instance Type: ${instanceType}`);
    lines.push(`Realms: ${realms.join(', ')}`);
    lines.push('');

    // ------------------------------------------------------------------
    // 1. Per-realm data: usage CSV (description, type, default, values) + P-level
    // ------------------------------------------------------------------
    lines.push(separator);
    lines.push('  PER-REALM DATA');
    lines.push(separator);

    for (const realm of realms) {
        lines.push('');
        lines.push(thinSeparator);
        lines.push(`  Realm: ${realm}`);
        lines.push(thinSeparator);

        // 1a. Deletion tier (read first to decide whether missing usage is expected)
        const tier = getTierFromDeletionFile(realm, instanceType, preferenceId);
        const noValuesTier = tier === 'P1' || tier === 'P3';

        // 1b. Attribute metadata from usage CSV (type, description, default)
        const usageFiles = findAllUsageFiles([realm]);
        let usageFound = false;

        for (const { usageFile } of usageFiles) {
            const data = extractPreferenceFromUsageCSV(usageFile, preferenceId);
            if (!data) {
                continue;
            }

            usageFound = true;
            lines.push(`  Type:          ${data.type || 'N/A'}`);
            lines.push(`  Description:   ${data.description || 'N/A'}`);
            lines.push(`  Default Value: ${data.defaultValue || 'N/A'}`);
            lines.push(`  Group:         ${data.groupId || 'N/A'}`);

            lines.push('');
            lines.push('  Site Values:');

            const siteEntries = Object.entries(data.siteValues);
            if (siteEntries.length === 0) {
                lines.push('    (no site-level values set)');
            } else {
                for (const [site, value] of siteEntries) {
                    const displayValue = value.length > 80
                        ? value.substring(0, 77) + '...'
                        : value;
                    lines.push(`    ${site}: ${displayValue}`);
                }
            }
        }

        if (!usageFound && !noValuesTier) {
            lines.push(
                '  [Usage data not available'
                + ' — run analyze-preferences to generate]'
            );
        }

        // 1c. P-level
        lines.push('');
        if (tier) {
            const desc = TIER_DESCRIPTIONS[tier] || '';
            lines.push(`  Deletion Tier: [${tier}] ${desc}`);
        } else {
            lines.push(
                '  Deletion Tier: N/A (not a deletion candidate on this realm)'
            );
        }
    }

    // ------------------------------------------------------------------
    // 2. Code references from pre-generated references file
    // ------------------------------------------------------------------
    lines.push('');
    lines.push(separator);
    lines.push('  CODE REFERENCES');
    lines.push(separator);

    const codeData = loadCodeReferences(instanceType, preferenceId);

    if (!codeData) {
        lines.push('');
        lines.push(
            '  [References file not found'
            + ' — run analyze-preferences to generate]'
        );
    } else if (codeData.references.length === 0) {
        lines.push('');
        lines.push('  Cartridges: (none)');
        lines.push('  Total matches: 0');
    } else {
        lines.push('');
        lines.push(
            `  Cartridges: ${codeData.cartridges.join(', ') || '(none)'}`
        );
        lines.push(`  Total matches: ${codeData.references.length}`);
        lines.push('');

        // Group references by cartridge
        const byCartridge = new Map();
        for (const ref of codeData.references) {
            const key = ref.cartridge || '(unknown)';
            if (!byCartridge.has(key)) {
                byCartridge.set(key, []);
            }
            byCartridge.get(key).push(ref);
        }

        for (const [cartridge, refs] of byCartridge) {
            lines.push(`  ${cartridge}:`);
            for (const r of refs) {
                lines.push(`    ${r.file}:${r.line}`);
                lines.push(`      ${r.text}`);
            }
            lines.push('');
        }
    }

    lines.push(separator);
    lines.push('  END OF REPORT');
    lines.push(separator);

    return lines.join('\n');
}

/**
 * Write the inspection report to the results directory and open it.
 * Overwrites the previous report file.
 * @param {string} report - Formatted report text
 * @param {string} instanceType - Instance type
 * @returns {string} Path to the written report file
 */
export function writeInspectionReport(report, instanceType) {
    const resultsDir = ensureResultsDir(IDENTIFIERS.ALL_REALMS, instanceType);
    const outputPath = path.join(resultsDir, INSPECT_OUTPUT_FILE);

    fs.writeFileSync(outputPath, report, 'utf-8');
    return outputPath;
}
