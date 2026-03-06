import fs from 'fs';
import path from 'path';

import { refreshMetadataBackupForRealm } from '../../../helpers/backupJob.js';
import { getSandboxConfig, getWebdavConfig } from '../../../config/helpers/helpers.js';
import { getRealmMetaDir } from './metaFileCleanup.js';

// ============================================================================
// META FILE CONSOLIDATION
// ============================================================================

/**
 * Build the single-file meta filename for a realm (no date, no "backup" suffix).
 * @param {string} realmIdentifier - Hostname or realm name
 * @returns {string} Filename like "<hostname>_meta_data.xml"
 */
export function buildConsolidatedMetaFileName(realmIdentifier) {
    const safe = String(realmIdentifier || 'unknown').replace(/[^A-Za-z0-9.-]/g, '-');
    return `${safe}_meta_data.xml`;
}

/**
 * Remove all XML files from a directory except the one to keep.
 * @param {string} dirPath - Absolute path to the meta directory
 * @param {string} keepFileName - Filename to preserve
 * @returns {{ removed: string[], kept: string }} Summary of removals
 */
export function removeOtherXmlFiles(dirPath, keepFileName) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const removed = [];

    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }

        const isXml = entry.name.toLowerCase().endsWith('.xml');
        if (isXml && entry.name !== keepFileName) {
            fs.unlinkSync(path.join(dirPath, entry.name));
            removed.push(entry.name);
        }
    }

    return { removed, kept: keepFileName };
}

/**
 * Consolidate meta files for a single realm into one file.
 *
 * Triggers a backup job on the realm, downloads the fresh meta XML,
 * copies it into the realm's meta directory as `<hostname>_meta_data.xml`,
 * and removes all other XML files from that directory.
 *
 * The backup file in `backup_downloads/` is left untouched.
 *
 * @param {Object} options
 * @param {string} options.repoPath - Absolute path to the sibling repository
 * @param {string} options.realm - Realm name
 * @param {string} options.instanceType - Instance type (e.g. "development")
 * @returns {Promise<{ok: boolean, realm: string, metaFile?: string, removed?: string[], reason?: string}>}
 */
export async function consolidateMetaFilesForRealm({ repoPath, realm, instanceType }) {
    const realmConfig = getSandboxConfig(realm);
    if (!realmConfig) {
        return { ok: false, realm, reason: `No config found for realm ${realm}` };
    }

    const webdavConfig = getWebdavConfig(realm);
    const realmIdentifier = webdavConfig.name || webdavConfig.hostname;
    const metaDir = getRealmMetaDir(repoPath, realmConfig.siteTemplatesPath);

    if (!fs.existsSync(metaDir)) {
        return { ok: false, realm, reason: `Meta directory not found: ${metaDir}` };
    }

    // â”€â”€ 1. Trigger backup job and download fresh meta XML â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    console.log(`  ${realm}: triggering backup job for fresh metadata...`);

    const result = await refreshMetadataBackupForRealm(
        realm, instanceType, { forceJobExecution: true }
    );

    if (!result.ok) {
        return { ok: false, realm, reason: result.reason || 'Backup job failed' };
    }

    // â”€â”€ 2. Copy downloaded file to realm's meta directory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const consolidatedName = buildConsolidatedMetaFileName(realmIdentifier);
    const destinationPath = path.join(metaDir, consolidatedName);

    try {
        fs.copyFileSync(result.filePath, destinationPath);
    } catch (copyError) {
        return {
            ok: false,
            realm,
            reason: `Failed to copy meta file to ${destinationPath}: ${copyError.message}`
        };
    }

    // â”€â”€ 3. Remove all other XML files from meta directory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { removed } = removeOtherXmlFiles(metaDir, consolidatedName);

    console.log(
        `  ${realm}: consolidated to ${consolidatedName}`
        + (removed.length > 0 ? ` (removed ${removed.length} old file(s))` : '')
    );

    return { ok: true, realm, metaFile: consolidatedName, removed };
}

/**
 * Consolidate meta files for multiple realms.
 *
 * Runs the backup job on each realm sequentially, copies the fresh meta XML
 * into each realm's meta directory, and removes old XML files.
 *
 * @param {Object} options
 * @param {string} options.repoPath - Absolute path to the sibling repository
 * @param {string[]} options.realmList - Realm names to consolidate
 * @param {string} options.instanceType - Instance type
 * @returns {Promise<{results: Array, successCount: number, failCount: number}>}
 */
export async function consolidateMetaFiles({ repoPath, realmList, instanceType }) {
    const results = [];

    for (const realm of realmList) {
        const result = await consolidateMetaFilesForRealm({
            repoPath, realm, instanceType
        });
        results.push(result);
    }

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.filter(r => !r.ok).length;

    return { results, successCount, failCount };
}

/**
 * Format consolidation results for console output.
 * @param {Object} consolidation - Return value from consolidateMetaFiles
 * @param {Array} consolidation.results - Per-realm results
 * @param {number} consolidation.successCount - Count of successful consolidations
 * @param {number} consolidation.failCount - Count of failed consolidations
 * @returns {string} Formatted output string
 */
export function formatConsolidationResults({ results, successCount, failCount }) {
    const lines = ['\n  Meta File Consolidation Summary:'];

    for (const r of results) {
        if (r.ok) {
            const removedCount = r.removed ? r.removed.length : 0;
            lines.push(`    âœ“ ${r.realm}: ${r.metaFile} (${removedCount} file(s) removed)`);
        } else {
            lines.push(`    âœ— ${r.realm}: ${r.reason}`);
        }
    }

    lines.push(`\n  Total: ${successCount} succeeded, ${failCount} failed`);
    return lines.join('\n');
}
