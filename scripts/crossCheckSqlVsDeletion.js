#!/usr/bin/env node
/**
 * Cross-check SQL dump results against deletion candidate lists.
 *
 * Reads TSV files from the SQL dumps folder and per-realm deletion files
 * from results/, then reports overlap and gaps.
 */

import fs from 'fs';
import path from 'path';

// ── Configuration ──────────────────────────────────────────────────────────────

const SQL_DUMPS_DIR = path.resolve(process.env.USERPROFILE, 'Downloads', 'site prefs dumps (1)');
const RESULTS_DIR = path.resolve('results', 'development');
const STALE_MONTHS = 6;

// Map SQL file instance abbreviations → our realm names
const INSTANCE_TO_REALM = {
    BCWR: 'EU05',
    BCJP: 'APAC',
    AAKF: 'PNA',
    BGBN: 'GB'
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse a TSV file into an array of { name, lastModified }.
 * @param {string} filePath - Path to the TSV file
 * @returns {{ name: string, lastModified: string }[]}
 */
function parseTsv(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    // Skip header row
    return lines.slice(1).map(line => {
        const [name, lastModified] = line.split('\t');
        return { name: name?.trim(), lastModified: lastModified?.trim() };
    }).filter(r => r.name);
}

/**
 * Parse a last-modified value from the SQL dump into a Date.
 * Supports ISO strings and SQL-style timestamps without a timezone.
 * @param {string} value - Raw last-modified value from TSV
 * @returns {Date|null} Parsed date or null when invalid
 */
function parseLastModified(value) {
    if (!value) {
        return null;
    }

    const normalizedValue = value.trim().replace(' ', 'T');
    const parsedDate = new Date(normalizedValue);

    return Number.isNaN(parsedDate.getTime())
        ? null
        : parsedDate;
}

/**
 * Determine whether a last-modified value is older than the configured threshold.
 * @param {string} lastModified - Raw last-modified value from TSV
 * @param {Date} cutoffDate - Cutoff date for stale preferences
 * @returns {boolean} True when the preference is older than the cutoff
 */
function isOlderThanCutoff(lastModified, cutoffDate) {
    const parsedDate = parseLastModified(lastModified);

    return parsedDate !== null && parsedDate < cutoffDate;
}

/**
 * Parse a deletion candidate file and return a map of prefName → tier.
 * @param {string} filePath - Path to the deletion file
 * @returns {Map<string, string>} prefName → tier (P1..P5)
 */
function parseDeletionFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const prefMap = new Map();
    let currentTier = null;

    for (const line of lines) {
        // Detect tier header: --- [P1] ... ---
        const tierMatch = line.match(/---\s*\[P(\d)]/);
        if (tierMatch) {
            currentTier = `P${tierMatch[1]}`;
            continue;
        }
        if (!currentTier) continue;

        // Skip empty/header/separator lines
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('---') || trimmed.startsWith('===')
            || trimmed.startsWith('NOTE:') || trimmed.startsWith('•')
            || trimmed.startsWith('Priority') || trimmed.startsWith('[P')
            || trimmed.startsWith('Realm') || trimmed.startsWith('Each')
            || trimmed.startsWith('Dynamic') || trimmed.startsWith('When')
            || trimmed.startsWith('If the')) {
            continue;
        }

        // Per-realm files: just the preference name per line
        // ALL_REALMS file: "prefName  |  realms: ALL" or "prefName  |  realms: EU05, APAC"
        const prefName = trimmed.split('|')[0].trim().split(/\s{2,}/)[0].trim();
        if (prefName && !prefName.includes(':') && !prefName.startsWith('[')
            && !prefName.startsWith('Generated') && !prefName.startsWith('Site')
            && !prefName.startsWith('Instance') && !prefName.startsWith('Analysis')
            && !prefName.startsWith('Total') && prefName.length > 1) {
            prefMap.set(prefName, currentTier);
        }
    }
    return prefMap;
}

/**
 * Parse the SQL file name to extract instance code and env (PRD/STG).
 * @param {string} fileName - e.g. "sql_results-BCJP_PRD-1755073700872.tsv"
 * @returns {{ instanceCode: string, env: string } | null}
 */
function parseSqlFileName(fileName) {
    const match = fileName.match(/^sql_results-(\w+)_(PRD|STG)-/);
    if (!match) return null;
    return { instanceCode: match[1], env: match[2] };
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - STALE_MONTHS);

    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║   SQL Dumps vs Deletion Candidates — Cross-Check Report          ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');
    console.log(
        `Comparing only preferences last modified before ${cutoffDate.toISOString().split('T')[0]}`
        + ` (${STALE_MONTHS}+ months old).\n`
    );

    // 1. Load all deletion files (per-realm only, not ALL_REALMS global)
    const realmDeletionMaps = {};
    const realms = ['EU05', 'APAC', 'PNA', 'GB'];
    for (const realm of realms) {
        const delFile = path.join(RESULTS_DIR, realm, `${realm}_preferences_for_deletion.txt`);
        if (fs.existsSync(delFile)) {
            realmDeletionMaps[realm] = parseDeletionFile(delFile);
        }
    }

    // Also load the global ALL_REALMS deletion file
    const globalDelFile = path.join(RESULTS_DIR, 'ALL_REALMS', 'development_preferences_for_deletion.txt');
    const globalDeletionMap = fs.existsSync(globalDelFile) ? parseDeletionFile(globalDelFile) : new Map();

    // Build combined set of ALL deletion candidates across all realms
    const allDeletionCandidates = new Map();
    for (const [realm, map] of Object.entries(realmDeletionMaps)) {
        for (const [pref, tier] of map) {
            if (!allDeletionCandidates.has(pref)) {
                allDeletionCandidates.set(pref, { tiers: {}, realms: [] });
            }
            allDeletionCandidates.get(pref).tiers[realm] = tier;
            allDeletionCandidates.get(pref).realms.push(realm);
        }
    }
    for (const [pref, tier] of globalDeletionMap) {
        if (!allDeletionCandidates.has(pref)) {
            allDeletionCandidates.set(pref, { tiers: { global: tier }, realms: ['ALL'] });
        }
    }

    console.log(`Loaded deletion candidates: ${allDeletionCandidates.size} unique preferences\n`);
    for (const realm of realms) {
        if (realmDeletionMaps[realm]) {
            console.log(`  ${realm}: ${realmDeletionMaps[realm].size} deletion candidates`);
        }
    }
    console.log(`  ALL_REALMS (global): ${globalDeletionMap.size} deletion candidates\n`);

    // 2. Load SQL dump files
    const sqlFiles = fs.readdirSync(SQL_DUMPS_DIR)
        .filter(f => f.endsWith('.tsv') && f.startsWith('sql_results-'));

    // Collect combined SQL prefs across all files
    const allSqlPrefs = new Set();
    const sqlDataByFile = [];

    for (const file of sqlFiles) {
        const parsed = parseSqlFileName(file);
        if (!parsed) continue;

        const realm = INSTANCE_TO_REALM[parsed.instanceCode] || parsed.instanceCode;
        const allRecords = parseTsv(path.join(SQL_DUMPS_DIR, file));
        const records = allRecords.filter(record => isOlderThanCutoff(record.lastModified, cutoffDate));
        const prefNames = new Set(records.map(r => r.name));
        records.forEach(r => allSqlPrefs.add(r.name));

        sqlDataByFile.push({
            file,
            instanceCode: parsed.instanceCode,
            env: parsed.env,
            realm,
            totalRecords: allRecords.length,
            records,
            prefNames
        });
    }

    console.log(`SQL dump files: ${sqlFiles.length} files, ${allSqlPrefs.size} unique preferences total\n`);
    console.log('═'.repeat(70) + '\n');

    // 3. Per-file analysis
    for (const data of sqlDataByFile) {
        const { file, instanceCode, env, realm, totalRecords, records, prefNames } = data;
        const realmDeletion = realmDeletionMaps[realm];

        console.log(`┌──────────────────────────────────────────────────────────────────┐`);
        console.log(`│ ${file}`);
        console.log(`│ Instance: ${instanceCode} (${env}) → Realm: ${realm}`);
        console.log(`│ Total prefs in SQL dump: ${totalRecords}`);
        console.log(`│ Older than ${STALE_MONTHS} months: ${records.length}`);
        console.log(`└──────────────────────────────────────────────────────────────────┘`);

        // Match against realm-specific deletion list
        if (realmDeletion) {
            const inBothRealmSpecific = [];
            const inSqlNotInRealm = [];
            const tierCounts = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 };

            for (const pref of prefNames) {
                if (realmDeletion.has(pref)) {
                    const tier = realmDeletion.get(pref);
                    inBothRealmSpecific.push({ name: pref, tier });
                    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
                } else {
                    inSqlNotInRealm.push(pref);
                }
            }

            const inRealmNotInSql = [];
            for (const [pref] of realmDeletion) {
                if (!prefNames.has(pref)) {
                    inRealmNotInSql.push(pref);
                }
            }

            const matchPct = records.length > 0
                ? ((inBothRealmSpecific.length / records.length) * 100).toFixed(1)
                : '0.0';

            console.log(`\n  ✓ OVERLAP with ${realm} deletion list: ${inBothRealmSpecific.length} / ${records.length} (${matchPct}%)`);
            console.log(`    By tier: P1=${tierCounts.P1} P2=${tierCounts.P2} P3=${tierCounts.P3} P4=${tierCounts.P4} P5=${tierCounts.P5}`);
            console.log(`  ✗ In SQL but NOT in ${realm} deletion list: ${inSqlNotInRealm.length}`);
            console.log(`  ◦ In ${realm} deletion list but NOT in SQL: ${inRealmNotInSql.length}`);

            // Show SQL-only preferences (potential new deletion candidates)
            if (inSqlNotInRealm.length > 0) {
                console.log(`\n  ── Preferences in SQL but NOT in ${realm} deletion list (${inSqlNotInRealm.length}): ──`);
                for (const pref of inSqlNotInRealm.sort()) {
                    // Check if it's in the global list
                    const globalTier = globalDeletionMap.has(pref) ? ` [global: ${globalDeletionMap.get(pref)}]` : '';
                    const sqlRecord = records.find(r => r.name === pref);
                    const lastMod = sqlRecord?.lastModified || '';
                    console.log(`    ${pref}  (last modified: ${lastMod})${globalTier}`);
                }
            }
        } else {
            console.log(`\n  ⚠ No realm-specific deletion list found for ${realm}`);

            // Fall back to global deletion list
            const inGlobal = [];
            const notInGlobal = [];
            for (const pref of prefNames) {
                if (globalDeletionMap.has(pref)) {
                    inGlobal.push({ name: pref, tier: globalDeletionMap.get(pref) });
                } else {
                    notInGlobal.push(pref);
                }
            }
            console.log(`  ✓ OVERLAP with global deletion list: ${inGlobal.length} / ${records.length}`);
            console.log(`  ✗ In SQL but NOT in global list: ${notInGlobal.length}`);
        }

        console.log('\n' + '─'.repeat(70) + '\n');
    }

    // 4. Aggregate summary
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║                     AGGREGATE SUMMARY                            ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    const overlapAll = new Set();
    const sqlOnlyAll = new Set();

    for (const pref of allSqlPrefs) {
        if (allDeletionCandidates.has(pref)) {
            overlapAll.add(pref);
        } else {
            sqlOnlyAll.add(pref);
        }
    }

    const deletionOnlyAll = new Set();
    for (const [pref] of allDeletionCandidates) {
        if (!allSqlPrefs.has(pref)) {
            deletionOnlyAll.add(pref);
        }
    }

    console.log(`Total unique prefs in SQL dumps:         ${allSqlPrefs.size}`);
    console.log(`Total unique prefs in deletion lists:    ${allDeletionCandidates.size}`);
    console.log(`Overlap (in both):                       ${overlapAll.size} (${((overlapAll.size / allSqlPrefs.size) * 100).toFixed(1)}% of SQL)`);
    console.log(`In SQL only (not in any deletion list):  ${sqlOnlyAll.size}`);
    console.log(`In deletion lists only (not in SQL):     ${deletionOnlyAll.size}\n`);

    // Per-realm overlap summary table
    console.log('Per-Realm Overlap Summary:');
    console.log('┌────────────┬────────────┬────────────────┬────────────────┬─────────┐');
    console.log('│ SQL File   │ SQL Prefs  │ In Deletion    │ SQL-Only       │ Match % │');
    console.log('├────────────┼────────────┼────────────────┼────────────────┼─────────┤');

    for (const data of sqlDataByFile) {
        const { instanceCode, env, realm, records, prefNames } = data;
        const realmDeletion = realmDeletionMaps[realm] || globalDeletionMap;
        let overlap = 0;
        for (const pref of prefNames) {
            if (realmDeletion.has(pref)) overlap++;
        }
        const sqlOnly = prefNames.size - overlap;
        const pct = prefNames.size > 0 ? ((overlap / prefNames.size) * 100).toFixed(1) : '0.0';
        const label = `${instanceCode}_${env}`;
        console.log(`│ ${label.padEnd(10)} │ ${String(prefNames.size).padEnd(10)} │ ${String(overlap).padEnd(14)} │ ${String(sqlOnly).padEnd(14)} │ ${pct.padStart(5)}%  │`);
    }
    console.log('└────────────┴────────────┴────────────────┴────────────────┴─────────┘');

    // Show SQL-only preferences that are NOT in any deletion list
    if (sqlOnlyAll.size > 0 && sqlOnlyAll.size <= 200) {
        console.log(`\n── All preferences in SQL but NOT in any deletion list (${sqlOnlyAll.size}): ──\n`);
        const sorted = [...sqlOnlyAll].sort();
        for (const pref of sorted) {
            // Find which SQL files contain this pref
            const sources = sqlDataByFile
                .filter(d => d.prefNames.has(pref))
                .map(d => `${d.instanceCode}_${d.env}`)
                .join(', ');
            console.log(`  ${pref}  [found in: ${sources}]`);
        }
    } else if (sqlOnlyAll.size > 200) {
        console.log(`\n── ${sqlOnlyAll.size} preferences in SQL but NOT in any deletion list (too many to list) ──`);
        console.log('  Use --verbose flag or pipe output to a file for full list.');
    }

    console.log('\n' + '═'.repeat(70));
    console.log('Cross-check complete.\n');
}

main();
