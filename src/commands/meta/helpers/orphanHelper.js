/**
 * Orphan Detection Helper
 *
 * Compares BM metadata backup XML (what's deployed on SFCC) against
 * repo meta XML files (what's in code) to find orphan preferences:
 *
 * - "BM-only" (ghost on SFCC): exists on SFCC but has no XML definition
 *   in the repository. Created manually via Business Manager or deployed
 *   from a cartridge that was later removed.
 *
 * - "Repo-only" (ghost in XML): defined in repo XML but doesn't exist
 *   on SFCC. The definition was removed from BM/OCAPI without cleaning
 *   up the XML, or the cartridge isn't on the cartridge path.
 *
 * @module orphanHelper
 */

import fs from 'fs';
import path from 'path';
import { IDENTIFIERS } from '../../../config/constants.js';
import {
    findLatestMetadataFile,
    parseSitePreferencesFromMetadata
} from '../../../io/codeScanner.js';
import { ensureResultsDir } from '../../../io/util.js';
import {
    getSandboxConfig,
    getCoreSiteTemplatePath
} from '../../../config/helpers/helpers.js';

const ORPHAN_OUTPUT_FILE = 'preference_orphan_report.txt';

// ============================================================================
// REPO XML SCANNING
// ============================================================================

/**
 * Regex to detect a SitePreferences type-extension block inside XML content.
 * @private
 */
const SITE_PREF_TYPE_EXTENSION = /type-id=["']SitePreferences["']/i;

/**
 * List all XML files in a directory that contain SitePreferences definitions.
 * @param {string} metaDir - Absolute path to a meta/ directory
 * @returns {string[]} Array of absolute file paths
 * @private
 */
function listSitePrefMetaFiles(metaDir) {
    if (!fs.existsSync(metaDir)) {
        return [];
    }

    return fs.readdirSync(metaDir)
        .filter(name => name.endsWith('.xml'))
        .map(name => path.join(metaDir, name))
        .filter(filePath => {
            const content = fs.readFileSync(filePath, 'utf-8');
            return SITE_PREF_TYPE_EXTENSION.test(content);
        });
}

/**
 * Extract SitePreferences attribute-definition IDs from a single meta XML file.
 * Only extracts IDs from within `<type-extension type-id="SitePreferences">` blocks,
 * ignoring attribute definitions for other object types (Product, Order, etc.).
 * @param {string} filePath - Absolute path to a meta XML file
 * @returns {Set<string>} Set of attribute IDs found under SitePreferences
 * @private
 */
function extractAttributeIdsFromFile(filePath) {
    const ids = new Set();
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    let inSitePreferences = false;

    for (const line of lines) {
        if (line.includes('type-id="SitePreferences"')
            || line.includes('type-id=\'SitePreferences\'')) {
            inSitePreferences = true;
            continue;
        }

        if (inSitePreferences && line.includes('</type-extension>')) {
            inSitePreferences = false;
            continue;
        }

        if (inSitePreferences) {
            const match = line.match(/attribute-definition\s+attribute-id="([^"]+)"/);
            if (match) {
                ids.add(match[1]);
            }
        }
    }

    return ids;
}

/**
 * Collect all SitePreferences attribute IDs defined in a repository's meta XML files
 * for a specific realm. Only scans core + that realm's specific meta directory.
 *
 * @param {string} repoPath - Absolute path to the sibling SFCC repository
 * @param {string} realm - Realm name to scope the scan to
 * @returns {{ repoIds: Set<string>, fileMap: Map<string, string[]> }}
 *   repoIds: all unique attribute IDs found in core + realm-specific meta files
 *   fileMap: attributeId → array of file paths where it's defined
 */
export function collectRepoAttributeIds(repoPath, realm) {
    const repoIds = new Set();
    const fileMap = new Map();
    const scannedDirs = new Set();

    /**
     * Scan a single meta directory and register found IDs.
     * @param {string} metaDir - Absolute path to meta/ directory
     * @private
     */
    function scanDir(metaDir) {
        if (scannedDirs.has(metaDir)) {
            return;
        }
        scannedDirs.add(metaDir);

        const xmlFiles = listSitePrefMetaFiles(metaDir);
        for (const filePath of xmlFiles) {
            const ids = extractAttributeIdsFromFile(filePath);
            for (const id of ids) {
                repoIds.add(id);
                if (!fileMap.has(id)) {
                    fileMap.set(id, []);
                }
                fileMap.get(id).push(filePath);
            }
        }
    }

    // 1. Core meta directory (shared across all realms)
    const coreMetaDir = path.join(repoPath, getCoreSiteTemplatePath(), 'meta');
    scanDir(coreMetaDir);

    // 2. Realm-specific meta directory only
    try {
        const config = getSandboxConfig(realm);
        const realmMetaDir = path.join(repoPath, config.siteTemplatesPath, 'meta');
        scanDir(realmMetaDir);
    } catch {
        // Realm not in config — only core was scanned
    }

    return { repoIds, fileMap };
}

// ============================================================================
// ORPHAN DETECTION
// ============================================================================

/**
 * @typedef {Object} OrphanResult
 * @property {string} realm - Realm name
 * @property {string|null} metadataFile - Path to BM backup XML used (null if missing)
 * @property {number} bmCount - Number of preferences on SFCC (BM)
 * @property {number} repoCount - Number of preferences in repo XML
 * @property {string[]} bmOnly - Preference IDs on SFCC but not in repo
 * @property {string[]} repoOnly - Preference IDs in repo but not on SFCC
 * @property {Map<string, string[]>} repoOnlyFileMap - repoOnly ID → files where defined
 */

/**
 * Compare BM metadata backup against repo meta XMLs for a single realm.
 * Scans only core + this realm's specific meta directory.
 *
 * @param {Object} params
 * @param {string} params.realm - Realm name
 * @param {string} params.repoPath - Absolute path to the sibling repository
 * @returns {OrphanResult} Comparison result for this realm
 */
export function detectOrphansForRealm({ realm, repoPath }) {
    const { repoIds, fileMap } = collectRepoAttributeIds(repoPath, realm);
    const metadataFile = findLatestMetadataFile(realm);

    if (!metadataFile) {
        return {
            realm,
            metadataFile: null,
            bmCount: 0,
            repoCount: repoIds.size,
            bmOnly: [],
            repoOnly: [],
            repoOnlyFileMap: new Map()
        };
    }

    const bmIds = parseSitePreferencesFromMetadata(metadataFile);

    const bmOnly = [...bmIds].filter(id => !repoIds.has(id)).sort();
    const repoOnly = [...repoIds].filter(id => !bmIds.has(id)).sort();

    const repoOnlyFileMap = new Map();
    for (const id of repoOnly) {
        repoOnlyFileMap.set(id, fileMap.get(id) || []);
    }

    return {
        realm,
        metadataFile,
        bmCount: bmIds.size,
        repoCount: repoIds.size,
        bmOnly,
        repoOnly,
        repoOnlyFileMap
    };
}

// ============================================================================
// REPORT FORMATTING
// ============================================================================

/**
 * Format orphan detection results into a human-readable report.
 *
 * @param {Object} params
 * @param {OrphanResult[]} params.results - Per-realm orphan results
 * @param {string} params.repoPath - Repository path used
 * @param {string} params.instanceType - Instance type
 * @returns {string} Formatted report text
 */
export function formatOrphanReport({ results, repoPath, instanceType }) {
    const separator = '='.repeat(80);
    const thinSeparator = '-'.repeat(80);
    const lines = [];

    lines.push(separator);
    lines.push('  PREFERENCE ORPHAN DETECTION REPORT');
    lines.push(separator);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Instance Type: ${instanceType}`);
    lines.push(`Repository: ${path.basename(repoPath)}`);
    lines.push(`Realms: ${results.map(r => r.realm).join(', ')}`);
    lines.push('');

    // Summary table
    lines.push(thinSeparator);
    lines.push('  SUMMARY');
    lines.push(thinSeparator);
    lines.push('');

    const uniqueBmOnly = new Set();
    const uniqueRepoOnly = new Set();

    for (const r of results) {
        if (!r.metadataFile) {
            lines.push(`  ${r.realm}: ⚠ No BM backup found — skipped`);
            continue;
        }

        lines.push(
            `  ${r.realm}: BM=${r.bmCount}  Repo=${r.repoCount}`
            + `  | BM-only: ${r.bmOnly.length}  | Repo-only: ${r.repoOnly.length}`
        );
        for (const id of r.bmOnly) { uniqueBmOnly.add(id); }
        for (const id of r.repoOnly) { uniqueRepoOnly.add(id); }
    }

    lines.push('');
    lines.push(
        `  Totals (unique): BM-only=${uniqueBmOnly.size}`
        + `  Repo-only=${uniqueRepoOnly.size}`
    );

    // Per-realm detail
    for (const r of results) {
        if (!r.metadataFile) {
            continue;
        }

        lines.push('');
        lines.push(separator);
        lines.push(`  Realm: ${r.realm}`);
        lines.push(separator);
        lines.push(`  BM backup: ${path.basename(r.metadataFile)}`);
        lines.push('');

        // BM-only section
        lines.push(thinSeparator);
        lines.push(
            '  BM-ONLY (on SFCC but not in repo XML)'
            + ` — ${r.bmOnly.length} preference(s)`
        );
        lines.push(
            '  These were likely created in Business Manager or their XML'
            + ' definition was removed.'
        );
        lines.push(thinSeparator);

        if (r.bmOnly.length === 0) {
            lines.push('  (none)');
        } else {
            for (const id of r.bmOnly) {
                lines.push(`  ${id}`);
            }
        }

        lines.push('');

        // Repo-only section
        lines.push(thinSeparator);
        lines.push(
            '  REPO-ONLY (in repo XML but not on SFCC)'
            + ` — ${r.repoOnly.length} preference(s)`
        );
        lines.push(
            '  These definitions exist in code but are not deployed.'
            + ' They may be stale or belong to unused cartridges.'
        );
        lines.push(thinSeparator);

        if (r.repoOnly.length === 0) {
            lines.push('  (none)');
        } else {
            for (const id of r.repoOnly) {
                const files = r.repoOnlyFileMap.get(id) || [];
                const shortFiles = files.map(f => path.relative(path.dirname(repoPath), f));
                lines.push(`  ${id}`);
                for (const f of shortFiles) {
                    lines.push(`    └─ ${f}`);
                }
            }
        }
    }

    lines.push('');
    lines.push(separator);
    lines.push('  END OF REPORT');
    lines.push(separator);

    return lines.join('\n');
}

/**
 * Write the orphan report to the results directory.
 *
 * @param {string} report - Formatted report text
 * @param {string} instanceType - Instance type
 * @returns {string} Path to the written report file
 */
export function writeOrphanReport(report, instanceType) {
    const resultsDir = ensureResultsDir(IDENTIFIERS.ALL_REALMS, instanceType);
    const outputPath = path.join(resultsDir, ORPHAN_OUTPUT_FILE);

    fs.writeFileSync(outputPath, report, 'utf-8');
    return outputPath;
}
