import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/io/codeScanner.js', () => ({
    findLatestMetadataFile: vi.fn(),
    parseSitePreferencesFromMetadata: vi.fn()
}));

vi.mock('../../../src/io/util.js', () => ({
    ensureResultsDir: vi.fn(() => '/mock/results/ALL_REALMS'),
    getResultsPath: vi.fn(() => '/mock/results')
}));

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getSandboxConfig: vi.fn((realm) => ({
        hostname: `${realm.toLowerCase()}.example.com`,
        instanceType: 'development',
        siteTemplatesPath: `sites/site_template_${realm.toLowerCase()}`
    })),
    getCoreSiteTemplatePath: vi.fn(() => 'sites/site_template')
}));

import {
    findLatestMetadataFile,
    parseSitePreferencesFromMetadata
} from '../../../src/io/codeScanner.js';

import { ensureResultsDir } from '../../../src/io/util.js';

import {
    collectRepoAttributeIds,
    detectOrphansForRealm,
    formatOrphanReport,
    writeOrphanReport
} from '../../../src/commands/meta/helpers/orphanHelper.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a temporary directory with a meta XML file containing attribute definitions.
 * @param {string} tmpDir - Temp root
 * @param {string} relativeMetaDir - Relative path to meta dir (e.g., 'sites/site_template/meta')
 * @param {string[]} attributeIds - Attribute IDs to include in the XML
 */
function createMetaXml(tmpDir, relativeMetaDir, attributeIds) {
    const metaDir = path.join(tmpDir, relativeMetaDir);
    fs.mkdirSync(metaDir, { recursive: true });

    const definitions = attributeIds.map(id =>
        `        <attribute-definition attribute-id="${id}">\n`
        + `            <display-name xml:lang="x-default">${id}</display-name>\n`
        + '        </attribute-definition>'
    ).join('\n');

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<metadata>\n'
        + '    <type-extension type-id="SitePreferences">\n'
        + '        <custom-attribute-definitions>\n'
        + definitions + '\n'
        + '        </custom-attribute-definitions>\n'
        + '    </type-extension>\n'
        + '</metadata>';

    fs.writeFileSync(path.join(metaDir, 'meta.system.xml'), xml, 'utf-8');
}

// ============================================================================
// collectRepoAttributeIds
// ============================================================================

describe('collectRepoAttributeIds', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-repo-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('collects attribute IDs from core meta directory', () => {
        createMetaXml(tmpDir, 'sites/site_template/meta', ['enableSearch', 'showBanner']);

        const { repoIds, fileMap } = collectRepoAttributeIds(tmpDir, 'NOREALM');

        expect(repoIds.size).toBe(2);
        expect(repoIds.has('enableSearch')).toBe(true);
        expect(repoIds.has('showBanner')).toBe(true);
        expect(fileMap.get('enableSearch')).toHaveLength(1);
    });

    it('collects attribute IDs from realm-specific meta directory', () => {
        createMetaXml(tmpDir, 'sites/site_template_eu05/meta', ['realmPref']);

        const { repoIds } = collectRepoAttributeIds(tmpDir, 'EU05');

        expect(repoIds.has('realmPref')).toBe(true);
    });

    it('deduplicates IDs across core and realm directories', () => {
        createMetaXml(tmpDir, 'sites/site_template/meta', ['sharedPref', 'corePref']);
        createMetaXml(tmpDir, 'sites/site_template_eu05/meta', ['sharedPref', 'realmPref']);

        const { repoIds, fileMap } = collectRepoAttributeIds(tmpDir, 'EU05');

        expect(repoIds.size).toBe(3);
        expect(fileMap.get('sharedPref')).toHaveLength(2);
    });

    it('returns empty set when no meta files exist', () => {
        const { repoIds, fileMap } = collectRepoAttributeIds(tmpDir, 'EU05');

        expect(repoIds.size).toBe(0);
        expect(fileMap.size).toBe(0);
    });

    it('skips non-SitePreferences XML files', () => {
        const metaDir = path.join(tmpDir, 'sites', 'site_template', 'meta');
        fs.mkdirSync(metaDir, { recursive: true });

        const otherXml = '<?xml version="1.0"?>\n<metadata>\n'
            + '<type-extension type-id="Product">\n'
            + '<custom-attribute-definitions>\n'
            + '<attribute-definition attribute-id="productAttr">\n'
            + '</attribute-definition>\n'
            + '</custom-attribute-definitions>\n'
            + '</type-extension>\n</metadata>';

        fs.writeFileSync(path.join(metaDir, 'meta.product.xml'), otherXml, 'utf-8');

        const { repoIds } = collectRepoAttributeIds(tmpDir, 'NOREALM');
        expect(repoIds.size).toBe(0);
    });

    it('does not include other realms meta directories', () => {
        createMetaXml(tmpDir, 'sites/site_template/meta', ['corePref']);
        createMetaXml(tmpDir, 'sites/site_template_eu05/meta', ['eu05Pref']);
        createMetaXml(tmpDir, 'sites/site_template_apac/meta', ['apacPref']);

        // Scanning for EU05 should NOT include apacPref
        const { repoIds } = collectRepoAttributeIds(tmpDir, 'EU05');

        expect(repoIds.has('corePref')).toBe(true);
        expect(repoIds.has('eu05Pref')).toBe(true);
        expect(repoIds.has('apacPref')).toBe(false);
    });

    it('only extracts SitePreferences attributes from mixed type-extension files', () => {
        const metaDir = path.join(tmpDir, 'sites', 'site_template', 'meta');
        fs.mkdirSync(metaDir, { recursive: true });

        // File containing BOTH SitePreferences and Product type-extensions
        const mixedXml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<metadata>\n'
            + '    <type-extension type-id="Product">\n'
            + '        <custom-attribute-definitions>\n'
            + '            <attribute-definition attribute-id="productColor">\n'
            + '            </attribute-definition>\n'
            + '        </custom-attribute-definitions>\n'
            + '    </type-extension>\n'
            + '    <type-extension type-id="SitePreferences">\n'
            + '        <custom-attribute-definitions>\n'
            + '            <attribute-definition attribute-id="enableSearch">\n'
            + '            </attribute-definition>\n'
            + '        </custom-attribute-definitions>\n'
            + '    </type-extension>\n'
            + '    <type-extension type-id="Order">\n'
            + '        <custom-attribute-definitions>\n'
            + '            <attribute-definition attribute-id="orderFlag">\n'
            + '            </attribute-definition>\n'
            + '        </custom-attribute-definitions>\n'
            + '    </type-extension>\n'
            + '</metadata>';

        fs.writeFileSync(path.join(metaDir, 'meta.system.xml'), mixedXml, 'utf-8');

        const { repoIds } = collectRepoAttributeIds(tmpDir, 'NOREALM');

        // Only the SitePreferences attribute should be collected
        expect(repoIds.size).toBe(1);
        expect(repoIds.has('enableSearch')).toBe(true);
        expect(repoIds.has('productColor')).toBe(false);
        expect(repoIds.has('orderFlag')).toBe(false);
    });
});

// ============================================================================
// detectOrphansForRealm
// ============================================================================

describe('detectOrphansForRealm', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-detect-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty results when no BM backup exists', () => {
        findLatestMetadataFile.mockReturnValue(null);
        createMetaXml(tmpDir, 'sites/site_template/meta', ['prefA', 'prefB']);

        const result = detectOrphansForRealm({ realm: 'EU05', repoPath: tmpDir });

        expect(result.metadataFile).toBeNull();
        expect(result.bmOnly).toEqual([]);
        expect(result.repoOnly).toEqual([]);
    });

    it('finds BM-only preferences (on SFCC but not in repo)', () => {
        findLatestMetadataFile.mockReturnValue('/backup/EU05_meta.xml');
        parseSitePreferencesFromMetadata.mockReturnValue(
            new Set(['prefA', 'prefB', 'bmOnlyPref'])
        );
        createMetaXml(tmpDir, 'sites/site_template/meta', ['prefA', 'prefB']);

        const result = detectOrphansForRealm({ realm: 'EU05', repoPath: tmpDir });

        expect(result.bmOnly).toEqual(['bmOnlyPref']);
        expect(result.repoOnly).toEqual([]);
        expect(result.bmCount).toBe(3);
    });

    it('finds repo-only preferences (in repo but not on SFCC)', () => {
        findLatestMetadataFile.mockReturnValue('/backup/EU05_meta.xml');
        parseSitePreferencesFromMetadata.mockReturnValue(
            new Set(['prefA'])
        );
        createMetaXml(tmpDir, 'sites/site_template/meta', ['prefA', 'prefB', 'repoOnlyPref']);

        const result = detectOrphansForRealm({ realm: 'EU05', repoPath: tmpDir });

        expect(result.bmOnly).toEqual([]);
        expect(result.repoOnly).toEqual(['prefB', 'repoOnlyPref']);
    });

    it('finds both BM-only and repo-only preferences', () => {
        findLatestMetadataFile.mockReturnValue('/backup/EU05_meta.xml');
        parseSitePreferencesFromMetadata.mockReturnValue(
            new Set(['shared', 'bmExtra'])
        );
        createMetaXml(tmpDir, 'sites/site_template/meta', ['shared', 'repoExtra']);

        const result = detectOrphansForRealm({ realm: 'EU05', repoPath: tmpDir });

        expect(result.bmOnly).toEqual(['bmExtra']);
        expect(result.repoOnly).toEqual(['repoExtra']);
    });

    it('returns sorted results', () => {
        findLatestMetadataFile.mockReturnValue('/backup/EU05_meta.xml');
        parseSitePreferencesFromMetadata.mockReturnValue(
            new Set(['zebra', 'alpha', 'middle'])
        );
        // No repo prefs — all BM items become BM-only

        const result = detectOrphansForRealm({ realm: 'EU05', repoPath: tmpDir });

        expect(result.bmOnly).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('reports zero orphans when BM and repo match exactly', () => {
        findLatestMetadataFile.mockReturnValue('/backup/EU05_meta.xml');
        parseSitePreferencesFromMetadata.mockReturnValue(
            new Set(['prefA', 'prefB'])
        );
        createMetaXml(tmpDir, 'sites/site_template/meta', ['prefA', 'prefB']);

        const result = detectOrphansForRealm({ realm: 'EU05', repoPath: tmpDir });

        expect(result.bmOnly).toEqual([]);
        expect(result.repoOnly).toEqual([]);
    });

    it('only compares against core + realm-specific dir, not other realms', () => {
        findLatestMetadataFile.mockReturnValue('/backup/EU05_meta.xml');
        parseSitePreferencesFromMetadata.mockReturnValue(
            new Set(['corePref', 'eu05Pref'])
        );
        createMetaXml(tmpDir, 'sites/site_template/meta', ['corePref']);
        createMetaXml(tmpDir, 'sites/site_template_eu05/meta', ['eu05Pref']);
        createMetaXml(tmpDir, 'sites/site_template_apac/meta', ['apacOnlyPref']);

        const result = detectOrphansForRealm({ realm: 'EU05', repoPath: tmpDir });

        // apacOnlyPref should NOT appear in repo-only (it's not in EU05's scope)
        expect(result.repoOnly).toEqual([]);
        expect(result.bmOnly).toEqual([]);
    });
});

// ============================================================================
// formatOrphanReport
// ============================================================================

describe('formatOrphanReport', () => {
    it('includes header and realm information', () => {
        const results = [{
            realm: 'EU05',
            metadataFile: '/backup/EU05_meta.xml',
            bmCount: 10,
            repoCount: 8,
            bmOnly: ['bmPref'],
            repoOnly: ['repoPref'],
            repoOnlyFileMap: new Map([['repoPref', ['/repo/meta/file.xml']]])
        }];

        const report = formatOrphanReport({
            results,
            repoPath: '/projects/storefront',
            instanceType: 'development'
        });

        expect(report).toContain('PREFERENCE ORPHAN DETECTION REPORT');
        expect(report).toContain('Instance Type: development');
        expect(report).toContain('Repository: storefront');
        expect(report).toContain('EU05');
    });

    it('shows summary counts', () => {
        const results = [{
            realm: 'EU05',
            metadataFile: '/backup/EU05_meta.xml',
            bmCount: 10,
            repoCount: 8,
            bmOnly: ['a', 'b'],
            repoOnly: ['c'],
            repoOnlyFileMap: new Map()
        }];

        const report = formatOrphanReport({
            results,
            repoPath: '/projects/storefront',
            instanceType: 'development'
        });

        expect(report).toContain('BM-only: 2');
        expect(report).toContain('Repo-only: 1');
        expect(report).toContain('Totals (unique): BM-only=2');
        expect(report).toContain('Repo-only=1');
    });

    it('shows warning for skipped realms with no BM backup', () => {
        const results = [{
            realm: 'APAC',
            metadataFile: null,
            bmCount: 0,
            repoCount: 5,
            bmOnly: [],
            repoOnly: [],
            repoOnlyFileMap: new Map()
        }];

        const report = formatOrphanReport({
            results,
            repoPath: '/projects/storefront',
            instanceType: 'development'
        });

        expect(report).toContain('No BM backup found');
        expect(report).toContain('APAC');
    });

    it('shows (none) when no orphans exist', () => {
        const results = [{
            realm: 'EU05',
            metadataFile: '/backup/EU05_meta.xml',
            bmCount: 5,
            repoCount: 5,
            bmOnly: [],
            repoOnly: [],
            repoOnlyFileMap: new Map()
        }];

        const report = formatOrphanReport({
            results,
            repoPath: '/projects/storefront',
            instanceType: 'development'
        });

        expect(report).toContain('(none)');
    });

    it('shows file paths for repo-only orphans', () => {
        const results = [{
            realm: 'EU05',
            metadataFile: '/backup/EU05_meta.xml',
            bmCount: 5,
            repoCount: 5,
            bmOnly: [],
            repoOnly: ['staleAttr'],
            repoOnlyFileMap: new Map([
                ['staleAttr', ['/projects/storefront/sites/site_template/meta/system.xml']]
            ])
        }];

        const report = formatOrphanReport({
            results,
            repoPath: '/projects/storefront',
            instanceType: 'development'
        });

        expect(report).toContain('staleAttr');
        expect(report).toContain('system.xml');
    });

    it('handles multiple realms', () => {
        const results = [
            {
                realm: 'EU05',
                metadataFile: '/backup/EU05_meta.xml',
                bmCount: 10,
                repoCount: 8,
                bmOnly: ['eu05Only'],
                repoOnly: [],
                repoOnlyFileMap: new Map()
            },
            {
                realm: 'APAC',
                metadataFile: '/backup/APAC_meta.xml',
                bmCount: 12,
                repoCount: 8,
                bmOnly: [],
                repoOnly: ['apacStale'],
                repoOnlyFileMap: new Map([['apacStale', []]])
            }
        ];

        const report = formatOrphanReport({
            results,
            repoPath: '/projects/storefront',
            instanceType: 'development'
        });

        expect(report).toContain('Realm: EU05');
        expect(report).toContain('Realm: APAC');
        expect(report).toContain('eu05Only');
        expect(report).toContain('apacStale');
    });

    it('deduplicates preferences across realms in totals', () => {
        const results = [
            {
                realm: 'EU05',
                metadataFile: '/backup/EU05_meta.xml',
                bmCount: 10,
                repoCount: 8,
                bmOnly: ['sharedGhost', 'eu05Only'],
                repoOnly: ['sharedStale'],
                repoOnlyFileMap: new Map()
            },
            {
                realm: 'PNA',
                metadataFile: '/backup/PNA_meta.xml',
                bmCount: 12,
                repoCount: 8,
                bmOnly: ['sharedGhost', 'pnaOnly'],
                repoOnly: ['sharedStale', 'pnaStale'],
                repoOnlyFileMap: new Map()
            }
        ];

        const report = formatOrphanReport({
            results,
            repoPath: '/projects/storefront',
            instanceType: 'development'
        });

        // Per-realm lines show per-realm counts (2 each for BM-only)
        expect(report).toContain('EU05:');
        expect(report).toContain('BM-only: 2');
        expect(report).toContain('PNA:');

        // Totals should deduplicate: sharedGhost + eu05Only + pnaOnly = 3 unique BM-only
        // sharedStale + pnaStale = 2 unique Repo-only
        expect(report).toContain('Totals (unique): BM-only=3  Repo-only=2');
    });
});

// ============================================================================
// writeOrphanReport
// ============================================================================

describe('writeOrphanReport', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-write-'));
        ensureResultsDir.mockReturnValue(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes report file and returns path', () => {
        const report = 'Test report content';
        const outputPath = writeOrphanReport(report, 'development');

        expect(outputPath).toContain('preference_orphan_report.txt');
        expect(fs.existsSync(outputPath)).toBe(true);
        expect(fs.readFileSync(outputPath, 'utf-8')).toBe(report);
    });

    it('overwrites existing report file', () => {
        const firstReport = 'First report';
        const secondReport = 'Second report';

        writeOrphanReport(firstReport, 'development');
        const outputPath = writeOrphanReport(secondReport, 'development');

        expect(fs.readFileSync(outputPath, 'utf-8')).toBe(secondReport);
    });
});
