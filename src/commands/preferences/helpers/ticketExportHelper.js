/**
 * Ticket Export Helper
 * Parses per-realm deletion files and writes per-P-level ticket attachment files.
 */

import fs from 'fs';
import path from 'path';
import { getResultsPath } from '../../../io/util.js';
import { FILE_PATTERNS, TIER_DESCRIPTIONS } from '../../../config/constants.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const TICKET_FILE_SUFFIX = '_ticket.txt';
const JIRA_FOLDER = 'jira_tickets';

/**
 * Parse a deletion file and return preference IDs grouped by tier.
 *
 * @param {string} content - Raw file content of a *_preferences_for_deletion.txt
 * @returns {Map<string, Array<{id: string}>>} tier to entries map
 * @private
 */
function parseDeletionFileByTier(content) {
    const tierMap = new Map();
    const lines = content.split(/\r?\n/);
    let currentTier = null;
    let inSection = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('--- [P')) {
            const tierMatch = trimmed.match(/\[P(\d)\]/);
            if (tierMatch) {
                currentTier = `P${tierMatch[1]}`;
                inSection = true;
                if (!tierMap.has(currentTier)) {
                    tierMap.set(currentTier, []);
                }
            }
            continue;
        }

        if (trimmed === '--- Blacklisted Preferences (Protected) ---') {
            break;
        }

        if (trimmed.startsWith('=')) {
            inSection = false;
            currentTier = null;
            continue;
        }

        if (!trimmed || !inSection || !currentTier) {
            continue;
        }

        const prefId = trimmed.split('  |  ')[0].trim();
        if (prefId) {
            tierMap.get(currentTier).push({ id: prefId });
        }
    }

    return tierMap;
}

/**
 * Extract the Analysis Summary block from a deletion file.
 *
 * @param {string} content - Raw file content
 * @returns {string} Summary block text, or empty string if not found
 * @private
 */
function extractAnalysisSummary(content) {
    const lines = content.split(/\r?\n/);
    const summaryLines = [];
    let inSummary = false;

    for (const line of lines) {
        if (line.trim().startsWith('Analysis Summary:')) {
            inSummary = true;
        }
        if (inSummary) {
            if (line.trim().startsWith('=')) {
                break;
            }
            summaryLines.push(line);
        }
    }

    return summaryLines.join('\n').trim();
}

/**
 * Build the content string for a single ticket attachment file.
 *
 * @param {Object} options
 * @param {string} options.realm - Realm name
 * @param {string} options.tier - Priority tier (e.g. 'P1')
 * @param {string} options.instanceType - Instance type
 * @param {Array<{id: string}>} options.entries - Preferences for this tier
 * @param {string} options.analysisSummary - Summary block from the original deletion file
 * @returns {string} File content
 * @private
 */
function buildTicketFileContent({ realm, tier, instanceType, entries, analysisSummary }) {
    const description = TIER_DESCRIPTIONS[tier] || tier;
    const generatedAt = new Date().toISOString();
    const sep = '='.repeat(80);
    const lines = [
        'Site Preferences - Jira Ticket List',
        '',
        `Realm:          ${realm}`,
        `Priority Level: [${tier}] ${description}`,
        `Instance Type:  ${instanceType}`,
        `Generated:      ${generatedAt}`,
        `Count:          ${entries.length}`,
        '',
        sep,
        '',
        'Priority Legend:',
        `  [P1] No code references, no values on ${realm} - safest to remove`,
        `  [P2] No code references, but has values/defaults on ${realm} - verify before removing`,
        `  [P3] Only in deprecated cartridges on ${realm}, no values - probably safe`,
        `  [P4] Only in deprecated cartridges on ${realm}, has values - needs careful review`,
        `  [P5] Active code only on other realms - these do not apply to ${realm}`,
        ''
    ];

    if (analysisSummary) {
        lines.push(analysisSummary);
        lines.push('');
    }

    lines.push(sep);
    lines.push('');
    lines.push(`--- [${tier}] Preferences (${entries.length}) ---`);
    lines.push('');

    for (const entry of entries) {
        lines.push(entry.id);
    }

    lines.push('');

    return lines.join('\n');
}

/**
 * Export per-P-level ticket attachment files for a single realm.
 * Reads the realm's deletion file and writes one file per tier that has entries.
 * Output goes to results/{instanceType}/{realm}/jira_tickets/.
 *
 * @param {string} realm - Realm name (e.g. 'APAC')
 * @param {string} instanceType - Instance type
 * @param {Object} [options] - Optional options
 * @param {string[]} [options.tiers] - Tiers to export (default: all P1-P4)
 * @returns {{
 *   realm: string,
 *   outputDir: string,
 *   written: Array<{tier: string, count: number, filePath: string}>,
 *   skipped: string[],
 *   sourceExists: boolean
 * }}
 */
export function exportTicketFilesForRealm(realm, instanceType, { tiers = ['P1', 'P2', 'P3', 'P4'] } = {}) {
    const resultsDir = getResultsPath(realm, instanceType);
    const sourceFile = path.join(resultsDir, `${realm}${FILE_PATTERNS.PREFERENCES_FOR_DELETION}`);

    if (!fs.existsSync(sourceFile)) {
        return { realm, outputDir: resultsDir, written: [], skipped: tiers, sourceExists: false };
    }

    const content = fs.readFileSync(sourceFile, 'utf-8');
    const tierMap = parseDeletionFileByTier(content);
    const analysisSummary = extractAnalysisSummary(content);

    const outputDir = path.join(resultsDir, JIRA_FOLDER);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const written = [];
    const skipped = [];

    for (const tier of tiers) {
        const entries = tierMap.get(tier) || [];
        if (entries.length === 0) {
            skipped.push(tier);
            continue;
        }

        const fileContent = buildTicketFileContent({ realm, tier, instanceType, entries, analysisSummary });
        const fileName = `${realm}_${tier}${TICKET_FILE_SUFFIX}`;
        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, fileContent, 'utf-8');

        written.push({ tier, count: entries.length, filePath });
    }

    return { realm, outputDir, written, skipped, sourceExists: true };
}
