/**
 * Preference Inspection Helper
 * Reads pre-generated results files to display comprehensive data
 * about a single preference or all preferences within a group.
 */

import fs from 'fs';
import path from 'path';
import {
    getResultsPath, ensureResultsDir, findAllUsageFiles, findAllMatrixFiles
} from '../../../io/util.js';
import { parseCSVToNestedArray } from '../../../io/csv.js';
import {
    FILE_PATTERNS, IDENTIFIERS, TIER_DESCRIPTIONS
} from '../../../config/constants.js';
import { isBlacklisted } from '../../setup/helpers/blacklistHelper.js';
import { isWhitelisted } from '../../setup/helpers/whitelistHelper.js';

/**
 * Output filename for the inspect-preference report.
 * This file is reused (overwritten) on each invocation.
 */
const INSPECT_OUTPUT_FILE = 'preference_inspection.md';
const GROUP_INSPECT_OUTPUT_PREFIX = 'preference_group_inspection';

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
            if (!headers[col].startsWith('value_')) {
                continue;
            }

            const siteName = headers[col].replace('value_', '');
            const value = row[col] || '';
            if (value) {
                siteValues[siteName] = value;
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
 * Extract basic presence data for a preference from a matrix CSV file.
 * Used as a fallback when the preference has no values and is absent from the usage CSV.
 * @param {string} matrixFilePath - Path to matrix CSV
 * @param {string} preferenceId - Preference ID to look up
 * @returns {{ defaultValue: string, sitePresence: Object }|null}
 */
function extractPreferenceFromMatrixCSV(matrixFilePath, preferenceId) {
    const csvData = parseCSVToNestedArray(matrixFilePath);

    if (csvData.length <= 1) {
        return null;
    }

    const headers = csvData[0];
    const prefIdIndex = headers.indexOf('preferenceId');
    const defaultValueIndex = headers.indexOf('defaultValue');

    if (prefIdIndex === -1) {
        return null;
    }

    for (let i = 1; i < csvData.length; i++) {
        const row = csvData[i];
        if (row[prefIdIndex] !== preferenceId) {
            continue;
        }

        const sitePresence = {};
        for (let col = 0; col < headers.length; col++) {
            if (col === prefIdIndex || col === defaultValueIndex) {
                continue;
            }

            const siteName = headers[col];
            const marker = (row[col] || '').trim();
            if (marker) {
                sitePresence[siteName] = marker;
            }
        }

        return {
            defaultValue: defaultValueIndex !== -1 ? (row[defaultValueIndex] || '') : '',
            sitePresence
        };
    }

    return null;
}

/**
 * Collect all preference IDs that belong to a given group from a usage CSV file.
 * @param {string} usageFilePath - Path to usage CSV
 * @param {string} groupId - Group ID to filter on
 * @returns {string[]} Matching preference IDs
 */
function getPreferenceIdsForGroupFromUsageCSV(usageFilePath, groupId) {
    const csvData = parseCSVToNestedArray(usageFilePath);

    if (csvData.length <= 1) {
        return [];
    }

    const headers = csvData[0];
    const groupIdIndex = headers.indexOf('groupId');
    const prefIdIndex = headers.indexOf('preferenceId');

    if (groupIdIndex === -1 || prefIdIndex === -1) {
        return [];
    }

    return csvData
        .slice(1)
        .filter((row) => row[groupIdIndex] === groupId && row[prefIdIndex])
        .map((row) => row[prefIdIndex]);
}

/**
 * Collect all available preference group IDs from the selected realms.
 * @param {string[]} realms - Realms to scan
 * @returns {string[]} Sorted unique group IDs
 */
export function getInspectablePreferenceGroupIds(realms) {
    const groupIds = new Set();

    for (const realm of realms) {
        const usageFiles = findAllUsageFiles([realm]);

        for (const { usageFile } of usageFiles) {
            const csvData = parseCSVToNestedArray(usageFile);

            if (csvData.length <= 1) {
                continue;
            }

            const headers = csvData[0];
            const groupIdIndex = headers.indexOf('groupId');

            if (groupIdIndex === -1) {
                continue;
            }

            for (const row of csvData.slice(1)) {
                const currentGroupId = row[groupIdIndex] || '';
                if (currentGroupId) {
                    groupIds.add(currentGroupId);
                }
            }
        }
    }

    return [...groupIds].sort((left, right) => left.localeCompare(right));
}

/**
 * Collect all unique preference IDs for a group across the selected realms.
 * @param {Object} options - Group lookup options
 * @param {string} options.groupId - Group ID to inspect
 * @param {string[]} options.realms - Realms to scan
 * @returns {string[]} Sorted unique preference IDs
 */
function getInspectablePreferenceIdsForGroup({ groupId, realms }) {
    const preferenceIds = new Set();

    for (const realm of realms) {
        const usageFiles = findAllUsageFiles([realm]);

        for (const { usageFile } of usageFiles) {
            const ids = getPreferenceIdsForGroupFromUsageCSV(usageFile, groupId);
            ids.forEach((preferenceId) => preferenceIds.add(preferenceId));
        }
    }

    return [...preferenceIds].sort((left, right) => left.localeCompare(right));
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
        refs.map((reference) => reference.cartridge).filter(Boolean)
    )].sort();

    return { references: refs, cartridges };
}

/**
 * Build the reusable Markdown report sections for a single preference.
 * @param {Object} options - Report options
 * @param {string} options.preferenceId - Preference ID
 * @param {string} options.instanceType - Instance type
 * @param {string[]} options.realms - Realms to inspect
 * @param {number} [options.headingLevel=1] - Base heading level (1 = #, 2 = ##)
 * @returns {string[]} Markdown report lines for the preference
 */
function buildPreferenceInspectionSections({
    preferenceId,
    instanceType,
    realms,
    headingLevel = 1
}) {
    const lines = [];
    const h1 = '#'.repeat(headingLevel);
    const h2 = '#'.repeat(headingLevel + 1);
    const h3 = '#'.repeat(headingLevel + 2);

    const whitelisted = isWhitelisted(preferenceId);
    const blacklisted = isBlacklisted(preferenceId);

    lines.push('| Property | Value |');
    lines.push('|----------|-------|');
    lines.push(`| Whitelisted | ${whitelisted ? '**YES**' : 'no'} |`);
    lines.push(
        `| Blacklisted | ${blacklisted ? '**YES** (protected — will not be deleted)' : 'no'} |`
    );
    lines.push('');

    lines.push(`${h2} Per-Realm Data`);
    lines.push('');

    for (const realm of realms) {
        lines.push(`${h3} Realm: ${realm}`);
        lines.push('');

        const tier = getTierFromDeletionFile(realm, instanceType, preferenceId);
        const usageFiles = findAllUsageFiles([realm]);
        let usageFound = false;

        for (const { usageFile } of usageFiles) {
            const data = extractPreferenceFromUsageCSV(usageFile, preferenceId);
            if (!data) {
                continue;
            }

            usageFound = true;

            lines.push('| Property | Value |');
            lines.push('|----------|-------|');
            lines.push(`| Type | \`${data.type || 'N/A'}\` |`);
            lines.push(`| Description | ${data.description || 'N/A'} |`);
            lines.push(`| Default Value | ${data.defaultValue ? `\`${data.defaultValue}\`` : 'N/A'} |`);
            lines.push(`| Group | \`${data.groupId || 'N/A'}\` |`);
            lines.push('');

            const siteEntries = Object.entries(data.siteValues);
            if (siteEntries.length === 0) {
                lines.push('**Site Values:** *(no site-level values set)*');
            } else {
                lines.push('**Site Values:**');
                lines.push('');
                lines.push('| Site | Value |');
                lines.push('|------|-------|');
                for (const [site, value] of siteEntries) {
                    const displayValue = value.length > 80
                        ? value.substring(0, 77) + '...'
                        : value;
                    lines.push(`| ${site} | \`${displayValue}\` |`);
                }
            }
            lines.push('');
        }

        if (!usageFound) {
            const matrixFiles = findAllMatrixFiles([realm]);

            for (const { matrixFile } of matrixFiles) {
                const matrixData = extractPreferenceFromMatrixCSV(
                    matrixFile,
                    preferenceId
                );
                if (!matrixData) {
                    continue;
                }

                usageFound = true;
                lines.push(
                    `**Default Value:** ${matrixData.defaultValue ? `\`${matrixData.defaultValue}\`` : '*(none)*'}`
                );

                const siteEntries = Object.entries(matrixData.sitePresence);
                if (siteEntries.length === 0) {
                    lines.push('**Site Values:** *(no site-level values set)*');
                } else {
                    lines.push('');
                    lines.push('**Sites with values:**');
                    lines.push('');
                    for (const [site] of siteEntries) {
                        lines.push(`- ${site}`);
                    }
                }

                lines.push('');
                lines.push(
                    '> *Source: matrix CSV — run `analyze-preferences`'
                    + ' for full detail*'
                );
            }

            lines.push('');
        }

        if (!usageFound) {
            lines.push(
                '> *No data found in results files'
                + ' — run `analyze-preferences` to generate*'
            );
            lines.push('');
        }

        if (tier) {
            const desc = TIER_DESCRIPTIONS[tier] || '';
            lines.push(`**Deletion Tier:** \`${tier}\` — ${desc}`);
        } else {
            lines.push(
                '**Deletion Tier:** N/A *(not a deletion candidate on this realm)*'
            );
        }
        lines.push('');
    }

    lines.push(`${h2} Code References`);
    lines.push('');

    const codeData = loadCodeReferences(instanceType, preferenceId);

    if (!codeData) {
        lines.push(
            '> *References file not found'
            + ' — run `analyze-preferences` to generate*'
        );
    } else if (codeData.references.length === 0) {
        lines.push('**Cartridges:** *(none)*');
        lines.push('**Total matches:** 0');
    } else {
        lines.push(
            `**Cartridges:** ${codeData.cartridges.map((c) => `\`${c}\``).join(', ') || '*(none)*'}`
        );
        lines.push(`**Total matches:** ${codeData.references.length}`);
        lines.push('');

        const byCartridge = new Map();

        for (const ref of codeData.references) {
            const key = ref.cartridge || '(unknown)';
            if (!byCartridge.has(key)) {
                byCartridge.set(key, []);
            }
            byCartridge.get(key).push(ref);
        }

        for (const [cartridge, refs] of byCartridge) {
            lines.push(`**\`${cartridge}\`:**`);
            lines.push('');
            for (const ref of refs) {
                lines.push(`- \`${ref.file}:${ref.line}\` — \`${ref.text}\``);
            }
            lines.push('');
        }
    }

    lines.push('');

    return lines;
}

/**
 * Build the full inspection report for a single preference using results files only.
 * @param {Object} params - Report options
 * @param {string} params.preferenceId - Preference ID
 * @param {string} params.instanceType - Instance type
 * @param {string[]} params.realms - Realms to inspect
 * @returns {string} Formatted report text
 */
export function buildInspectionReport({ preferenceId, instanceType, realms }) {
    const lines = [];

    lines.push(`# Preference Inspection: \`${preferenceId}\``);
    lines.push('');
    lines.push(`> **Generated:** ${new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}`);
    lines.push(`> **Instance Type:** ${instanceType}`);
    lines.push(`> **Realms:** ${realms.join(', ')}`);
    lines.push('');
    lines.push(
        ...buildPreferenceInspectionSections({
            preferenceId,
            instanceType,
            realms,
            headingLevel: 2
        })
    );
    lines.push('---');
    lines.push('*End of Report*');

    return lines.join('\n');
}

/**
 * Build a report for every preference that belongs to a selected group.
 * @param {Object} options - Report options
 * @param {string} options.groupId - Group ID to inspect
 * @param {string} options.instanceType - Instance type
 * @param {string[]} options.realms - Realms to inspect
 * @returns {string} Formatted group report text
 */
export function buildPreferenceGroupInspectionReport({
    groupId,
    instanceType,
    realms
}) {
    const lines = [];
    const preferenceIds = getInspectablePreferenceIdsForGroup({ groupId, realms });

    lines.push(`# Preference Group Inspection: \`${groupId}\``);
    lines.push('');
    lines.push(`> **Generated:** ${new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}`);
    lines.push(`> **Instance Type:** ${instanceType}`);
    lines.push(`> **Realms:** ${realms.join(', ')}`);
    lines.push(`> **Preferences Found:** ${preferenceIds.length}`);
    lines.push('');

    if (preferenceIds.length === 0) {
        lines.push(
            '> *No preferences found for this group'
            + ' in the selected results files*'
        );
        lines.push('');
        lines.push('---');
        lines.push('*End of Group Report*');
        return lines.join('\n');
    }

    lines.push('## Preference IDs');
    lines.push('');
    for (const preferenceId of preferenceIds) {
        lines.push(`- \`${preferenceId}\``);
    }
    lines.push('');

    for (const [index, preferenceId] of preferenceIds.entries()) {
        lines.push('---');
        lines.push('');
        lines.push(
            `## Preference ${index + 1} of ${preferenceIds.length}:`
            + ` \`${preferenceId}\``
        );
        lines.push('');
        lines.push(
            ...buildPreferenceInspectionSections({
                preferenceId,
                instanceType,
                realms,
                headingLevel: 3
            })
        );
    }

    lines.push('---');
    lines.push('*End of Group Report*');

    return lines.join('\n');
}

/**
 * Write a report file to the inspections directory.
 * Clears the directory first so only the latest report remains.
 * @param {string} report - Formatted report text
 * @param {string} outputFileName - Output filename
 * @returns {string} Path to the written report file
 */
function writeReportFile(report, outputFileName) {
    const inspectionsDir = path.join(process.cwd(), 'inspections');

    if (fs.existsSync(inspectionsDir)) {
        fs.rmSync(inspectionsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(inspectionsDir, { recursive: true });

    const outputPath = path.join(inspectionsDir, outputFileName);

    fs.writeFileSync(outputPath, report, 'utf-8');
    return outputPath;
}

/**
 * Write the inspection report to the inspections directory.
 * Overwrites any previous inspection files.
 * @param {string} report - Formatted report text
 * @returns {string} Path to the written report file
 */
export function writeInspectionReport(report) {
    return writeReportFile(report, INSPECT_OUTPUT_FILE);
}

/**
 * Write the group inspection report to the inspections directory.
 * @param {string} report - Formatted report text
 * @param {string} groupId - Group ID used to build the report
 * @returns {string} Path to the written report file
 */
export function writePreferenceGroupInspectionReport(report, groupId) {
    const safeGroupId = groupId.replace(/[^a-zA-Z0-9_-]+/g, '_');
    return writeReportFile(
        report,
        `${GROUP_INSPECT_OUTPUT_PREFIX}_${safeGroupId}.md`
    );
}