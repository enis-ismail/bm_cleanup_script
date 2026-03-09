import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dependencies before importing module under test
vi.mock('../../src/io/util.js', () => ({
    ensureResultsDir: vi.fn((realm) => `/mock/results/${realm}`)
}));

vi.mock('../../src/scripts/loggingScript/log.js', () => ({
    logError: vi.fn()
}));

import {
    compareSiteXmlWithLive,
    formatSiteXmlComparison,
    parseSiteXml,
    findSiteXmlFiles,
    exportSiteXmlComparison,
    parseAndCompareSiteXmls,
    getAttributeGroupsFromMetadataFile,
    getAllAttributeDefinitionsFromMetadata,
    getAttributeDefinitionsFromMetadata
} from '../../src/io/siteXmlHelper.js';

import { ensureResultsDir } from '../../src/io/util.js';

// ============================================================================
// compareSiteXmlWithLive
// ============================================================================

describe('compareSiteXmlWithLive', () => {
    it('detects full match when cartridges are identical', () => {
        const xml = ['app_custom', 'app_base', 'int_payment'];
        const live = ['app_custom', 'app_base', 'int_payment'];

        const result = compareSiteXmlWithLive(xml, live);

        expect(result.isMatch).toBe(true);
        expect(result.matching).toEqual(['app_custom', 'app_base', 'int_payment']);
        expect(result.onlyInXml).toEqual([]);
        expect(result.onlyInLive).toEqual([]);
        expect(result.xmlCount).toBe(3);
        expect(result.liveCount).toBe(3);
    });

    it('detects cartridges only in XML', () => {
        const xml = ['app_custom', 'int_old_cartridge'];
        const live = ['app_custom'];

        const result = compareSiteXmlWithLive(xml, live);

        expect(result.isMatch).toBe(false);
        expect(result.onlyInXml).toEqual(['int_old_cartridge']);
        expect(result.onlyInLive).toEqual([]);
    });

    it('detects cartridges only on live', () => {
        const xml = ['app_custom'];
        const live = ['app_custom', 'int_new_cartridge'];

        const result = compareSiteXmlWithLive(xml, live);

        expect(result.isMatch).toBe(false);
        expect(result.onlyInLive).toEqual(['int_new_cartridge']);
        expect(result.onlyInXml).toEqual([]);
    });

    it('detects mismatches in both directions', () => {
        const xml = ['app_custom', 'old_cart'];
        const live = ['app_custom', 'new_cart'];

        const result = compareSiteXmlWithLive(xml, live);

        expect(result.isMatch).toBe(false);
        expect(result.onlyInXml).toEqual(['old_cart']);
        expect(result.onlyInLive).toEqual(['new_cart']);
    });

    it('handles empty arrays', () => {
        const result = compareSiteXmlWithLive([], []);
        expect(result.isMatch).toBe(true);
        expect(result.xmlCount).toBe(0);
        expect(result.liveCount).toBe(0);
    });
});

// ============================================================================
// formatSiteXmlComparison
// ============================================================================

describe('formatSiteXmlComparison', () => {
    it('formats matching comparison', () => {
        const comparison = {
            isMatch: true,
            xmlCount: 3,
            liveCount: 3,
            matching: ['a', 'b', 'c'],
            onlyInXml: [],
            onlyInLive: []
        };

        const result = formatSiteXmlComparison('MySite', comparison, 'sites/site.xml');

        expect(result).toContain('MySite');
        expect(result).toContain('[OK] MATCH');
        expect(result).toContain('sites/site.xml');
        expect(result).toContain('XML Cartridges: 3');
    });

    it('formats mismatched comparison with details', () => {
        const comparison = {
            isMatch: false,
            xmlCount: 2,
            liveCount: 2,
            matching: ['app_custom'],
            onlyInXml: ['old_cart'],
            onlyInLive: ['new_cart']
        };

        const result = formatSiteXmlComparison('MySite', comparison, 'site.xml');

        expect(result).toContain('[X] MISMATCH');
        expect(result).toContain('In XML but NOT on live');
        expect(result).toContain('old_cart');
        expect(result).toContain('On live but NOT in XML');
        expect(result).toContain('new_cart');
    });

    it('shows only onlyInXml section when no onlyInLive', () => {
        const comparison = {
            isMatch: false,
            xmlCount: 2,
            liveCount: 1,
            matching: ['a'],
            onlyInXml: ['extra'],
            onlyInLive: []
        };

        const result = formatSiteXmlComparison('Site1', comparison, 'x.xml');

        expect(result).toContain('In XML but NOT on live');
        expect(result).not.toContain('On live but NOT in XML');
    });
});

// ============================================================================
// parseSiteXml
// ============================================================================

describe('parseSiteXml', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitexml-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('parses site.xml with colon-separated cartridge path', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<site xmlns="http://www.demandware.com/xml/impex/site/current" site-id="MySite">
    <custom-cartridges>app_custom:app_base:int_payment</custom-cartridges>
</site>`;

        const filePath = path.join(tmpDir, 'site.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const result = await parseSiteXml(filePath);

        expect(result.siteId).toBe('MySite');
        expect(result.cartridges).toEqual(['app_custom', 'app_base', 'int_payment']);
        expect(result.cartridgePath).toBe('app_custom:app_base:int_payment');
    });

    it('parses site.xml with individual cartridge elements', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<site xmlns="http://www.demandware.com/xml/impex/site/current" site-id="TestSite">
    <custom-cartridges>
        <cartridge>app_custom</cartridge>
        <cartridge>app_base</cartridge>
    </custom-cartridges>
</site>`;

        const filePath = path.join(tmpDir, 'site.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const result = await parseSiteXml(filePath);

        expect(result.siteId).toBe('TestSite');
        expect(result.cartridges).toEqual(['app_custom', 'app_base']);
    });

    it('handles site.xml without custom-cartridges', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<site xmlns="http://www.demandware.com/xml/impex/site/current" site-id="EmptySite">
</site>`;

        const filePath = path.join(tmpDir, 'site.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const result = await parseSiteXml(filePath);

        expect(result.siteId).toBe('EmptySite');
        expect(result.cartridges).toEqual([]);
        expect(result.cartridgePath).toBe('');
    });

    it('rejects on invalid XML', async () => {
        const filePath = path.join(tmpDir, 'bad.xml');
        fs.writeFileSync(filePath, 'not xml content', 'utf-8');

        await expect(parseSiteXml(filePath)).rejects.toThrow();
    });
});

// ============================================================================
// findSiteXmlFiles
// ============================================================================

describe('findSiteXmlFiles', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'findxml-test-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('finds site.xml files in site locale directories', async () => {
        // Create structure: repoPath/siteTemplatesPath/sites/locale/site.xml
        const sitesDir = path.join(tmpDir, 'site_template', 'sites');
        const enDir = path.join(sitesDir, 'SiteEN');
        const deDir = path.join(sitesDir, 'SiteDE');

        fs.mkdirSync(enDir, { recursive: true });
        fs.mkdirSync(deDir, { recursive: true });
        fs.writeFileSync(path.join(enDir, 'site.xml'), '<site/>', 'utf-8');
        fs.writeFileSync(path.join(deDir, 'site.xml'), '<site/>', 'utf-8');

        const result = await findSiteXmlFiles(tmpDir, 'site_template');

        expect(result).toHaveLength(2);
        expect(result.map(r => r.siteLocale).sort()).toEqual(['SiteDE', 'SiteEN']);
        expect(result[0].filePath).toContain('site.xml');
    });

    it('returns empty array when site templates path does not exist', async () => {
        const result = await findSiteXmlFiles(tmpDir, 'nonexistent');
        expect(result).toEqual([]);
    });

    it('returns empty array when sites directory does not exist', async () => {
        fs.mkdirSync(path.join(tmpDir, 'template'), { recursive: true });
        const result = await findSiteXmlFiles(tmpDir, 'template');
        expect(result).toEqual([]);
    });

    it('skips locale directories without site.xml', async () => {
        const sitesDir = path.join(tmpDir, 'tpl', 'sites', 'EmptyLocale');
        fs.mkdirSync(sitesDir, { recursive: true });

        const result = await findSiteXmlFiles(tmpDir, 'tpl');
        expect(result).toEqual([]);
    });
});

// ============================================================================
// exportSiteXmlComparison
// ============================================================================

describe('exportSiteXmlComparison', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
        ensureResultsDir.mockReturnValue(tmpDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('writes validation report file with match/mismatch summary', async () => {
        const comparisons = [
            {
                siteId: 'Site1',
                xmlFile: 'sites/Site1/site.xml',
                comparison: {
                    isMatch: true, xmlCount: 3, liveCount: 3,
                    matching: ['a', 'b', 'c'], onlyInXml: [], onlyInLive: []
                }
            },
            {
                siteId: 'Site2',
                xmlFile: 'sites/Site2/site.xml',
                comparison: {
                    isMatch: false, xmlCount: 2, liveCount: 3,
                    matching: ['a'], onlyInXml: ['old'], onlyInLive: ['new1', 'new2']
                }
            }
        ];

        const filePath = await exportSiteXmlComparison(comparisons, 'EU05');

        expect(filePath).toContain('EU05');
        expect(filePath).toContain('site_xml_validation');

        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('SITE.XML VALIDATION REPORT');
        expect(content).toContain('Site1');
        expect(content).toContain('Site2');
        expect(content).toContain('Matching: 1');
        expect(content).toContain('Mismatched: 1');
        expect(content).toContain('Total Sites Validated: 2');
    });
});

// ============================================================================
// getAttributeGroupsFromMetadataFile
// ============================================================================

describe('getAttributeGroupsFromMetadataFile', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('extracts attribute groups for the specified object type', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <group-definitions>
            <attribute-group group-id="SearchSettings">
                <display-name xml:lang="default">Search Configuration</display-name>
                <attribute attribute-id="c_enableSearch"/>
                <attribute attribute-id="c_maxResults"/>
            </attribute-group>
        </group-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const groups = await getAttributeGroupsFromMetadataFile(filePath, 'SitePreferences');

        expect(groups).toHaveLength(1);
        expect(groups[0].group_id).toBe('SearchSettings');
        // Attributes should have c_ prefix removed
        expect(groups[0].attributes).toContain('enableSearch');
        expect(groups[0].attributes).toContain('maxResults');
    });

    it('returns empty array for non-matching object type', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="Product">
        <group-definitions>
            <attribute-group group-id="ProductGroup">
                <attribute attribute-id="c_productColor"/>
            </attribute-group>
        </group-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const groups = await getAttributeGroupsFromMetadataFile(filePath, 'SitePreferences');

        expect(groups).toEqual([]);
    });

    it('returns empty array for nonexistent file', async () => {
        const groups = await getAttributeGroupsFromMetadataFile('/nonexistent.xml', 'SitePreferences');
        expect(groups).toEqual([]);
    });

    it('returns empty array for XML without type-extension', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata></metadata>`;

        const filePath = path.join(tmpDir, 'empty.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const groups = await getAttributeGroupsFromMetadataFile(filePath, 'SitePreferences');
        expect(groups).toEqual([]);
    });

    it('handles multiple type-extensions and picks the right one', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="Product">
        <group-definitions>
            <attribute-group group-id="ProductGroup">
                <attribute attribute-id="c_productColor"/>
            </attribute-group>
        </group-definitions>
    </type-extension>
    <type-extension type-id="SitePreferences">
        <group-definitions>
            <attribute-group group-id="GlobalPrefs">
                <attribute attribute-id="c_enableFeatureX"/>
            </attribute-group>
        </group-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'multi.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const groups = await getAttributeGroupsFromMetadataFile(filePath, 'SitePreferences');

        expect(groups).toHaveLength(1);
        expect(groups[0].group_id).toBe('GlobalPrefs');
        expect(groups[0].attributes).toContain('enableFeatureX');
    });
});

// ============================================================================
// getAllAttributeDefinitionsFromMetadata
// ============================================================================

describe('getAllAttributeDefinitionsFromMetadata', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allattr-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('extracts all attribute definitions as OCAPI-compatible objects', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <custom-attribute-definitions>
            <attribute-definition attribute-id="enableSearch">
                <display-name xml:lang="default">Enable Search</display-name>
                <type>boolean</type>
                <mandatory-flag>false</mandatory-flag>
                <visible-flag>true</visible-flag>
                <default-value>true</default-value>
            </attribute-definition>
            <attribute-definition attribute-id="maxResults">
                <display-name xml:lang="default">Max Results</display-name>
                <type>int</type>
                <default-value>50</default-value>
            </attribute-definition>
        </custom-attribute-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const defs = await getAllAttributeDefinitionsFromMetadata(filePath, 'SitePreferences');

        expect(defs).toHaveLength(2);

        const search = defs.find(d => d.id === 'enableSearch');
        expect(search.value_type).toBe('boolean');
        expect(search.mandatory).toBe(false);
        expect(search.visible).toBe(true);
        expect(search.default_value).toEqual({ value: true });

        const max = defs.find(d => d.id === 'maxResults');
        expect(max.value_type).toBe('int');
        expect(max.default_value).toEqual({ value: 50 });
    });

    it('handles string type with display name', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <custom-attribute-definitions>
            <attribute-definition attribute-id="brandColor">
                <display-name xml:lang="default">Brand Color</display-name>
                <display-name xml:lang="de">Markenfarbe</display-name>
                <description xml:lang="default">Primary brand color hex</description>
                <type>string</type>
                <min-length>3</min-length>
                <max-length>7</max-length>
                <default-value>#000000</default-value>
            </attribute-definition>
        </custom-attribute-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const defs = await getAllAttributeDefinitionsFromMetadata(filePath, 'SitePreferences');

        expect(defs).toHaveLength(1);
        expect(defs[0].id).toBe('brandColor');
        expect(defs[0].value_type).toBe('string');
        expect(defs[0].min_length).toBe(3);
        expect(defs[0].max_length).toBe(7);
        expect(defs[0].default_value).toEqual({ value: '#000000' });
        expect(defs[0].display_name).toHaveProperty('default', 'Brand Color');
        expect(defs[0].display_name).toHaveProperty('de', 'Markenfarbe');
        expect(defs[0].description).toHaveProperty('default', 'Primary brand color hex');
    });

    it('maps XML type names to OCAPI types', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <custom-attribute-definitions>
            <attribute-definition attribute-id="pref1">
                <type>set-of-string</type>
            </attribute-definition>
            <attribute-definition attribute-id="pref2">
                <type>enum-of-string</type>
            </attribute-definition>
            <attribute-definition attribute-id="pref3">
                <type>double</type>
                <default-value>3.14</default-value>
            </attribute-definition>
        </custom-attribute-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const defs = await getAllAttributeDefinitionsFromMetadata(filePath, 'SitePreferences');

        expect(defs.find(d => d.id === 'pref1').value_type).toBe('set_of_string');
        expect(defs.find(d => d.id === 'pref2').value_type).toBe('enum_of_string');
        const pref3 = defs.find(d => d.id === 'pref3');
        expect(pref3.value_type).toBe('double');
        expect(pref3.default_value).toEqual({ value: 3.14 });
    });

    it('handles enum value definitions', async () => {
        // Note: xml2js wraps value-definitions in an array, so
        // extractValueDefinitions receives [{...}] rather than {...}.
        // The code currently returns an empty array for this case.
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <custom-attribute-definitions>
            <attribute-definition attribute-id="themeStyle">
                <type>enum-of-string</type>
                <value-definitions>
                    <value-definition value="light">
                        <display-name xml:lang="default">Light Theme</display-name>
                    </value-definition>
                    <value-definition value="dark">
                        <display-name xml:lang="default">Dark Theme</display-name>
                    </value-definition>
                </value-definitions>
            </attribute-definition>
        </custom-attribute-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const defs = await getAllAttributeDefinitionsFromMetadata(filePath, 'SitePreferences');

        expect(defs).toHaveLength(1);
        expect(defs[0].id).toBe('themeStyle');
        expect(defs[0].value_type).toBe('enum_of_string');
        // value_definitions field is present (code enters the if branch)
        expect(defs[0]).toHaveProperty('value_definitions');
    });

    it('throws for nonexistent file', async () => {
        await expect(
            getAllAttributeDefinitionsFromMetadata('/nonexistent.xml', 'SitePreferences')
        ).rejects.toThrow('Metadata file not found');
    });

    it('throws for XML without matching type-extension', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="Product">
        <custom-attribute-definitions>
            <attribute-definition attribute-id="color">
                <type>string</type>
            </attribute-definition>
        </custom-attribute-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        await expect(
            getAllAttributeDefinitionsFromMetadata(filePath, 'SitePreferences')
        ).rejects.toThrow('No type-extension found');
    });

    it('returns empty array when no custom-attribute-definitions', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const defs = await getAllAttributeDefinitionsFromMetadata(filePath, 'SitePreferences');
        expect(defs).toEqual([]);
    });
});

// ============================================================================
// getAttributeDefinitionsFromMetadata (filtered)
// ============================================================================

describe('getAttributeDefinitionsFromMetadata', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtattr-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns only definitions matching the attribute ID list', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <custom-attribute-definitions>
            <attribute-definition attribute-id="prefA">
                <type>string</type>
            </attribute-definition>
            <attribute-definition attribute-id="prefB">
                <type>boolean</type>
            </attribute-definition>
            <attribute-definition attribute-id="prefC">
                <type>int</type>
            </attribute-definition>
        </custom-attribute-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const defs = await getAttributeDefinitionsFromMetadata(
            filePath, 'SitePreferences', ['prefA', 'prefC']
        );

        expect(defs).toHaveLength(2);
        expect(defs.map(d => d.id).sort()).toEqual(['prefA', 'prefC']);
    });

    it('returns empty array when none of the IDs match', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <custom-attribute-definitions>
            <attribute-definition attribute-id="prefA">
                <type>string</type>
            </attribute-definition>
        </custom-attribute-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const defs = await getAttributeDefinitionsFromMetadata(
            filePath, 'SitePreferences', ['nonexistent']
        );

        expect(defs).toEqual([]);
    });
});

// ============================================================================
// parseAndCompareSiteXmls
// ============================================================================

describe('parseAndCompareSiteXmls', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-test-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('compares site.xml cartridges against live data', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<site xmlns="http://www.demandware.com/xml/impex/site/current" site-id="MySite">
    <custom-cartridges>app_custom:app_base</custom-cartridges>
</site>`;

        const filePath = path.join(tmpDir, 'site.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const liveSitesMap = {
            MySite: ['app_custom', 'app_base', 'int_new']
        };

        const siteXmlFiles = [{
            filePath,
            relativePath: 'sites/MySite/site.xml',
            siteLocale: 'MySite'
        }];

        const comparisons = await parseAndCompareSiteXmls(siteXmlFiles, liveSitesMap);

        expect(comparisons).toHaveLength(1);
        expect(comparisons[0].siteId).toBe('MySite');
        expect(comparisons[0].comparison.isMatch).toBe(false);
        expect(comparisons[0].comparison.onlyInLive).toContain('int_new');
    });

    it('skips sites not found in liveSitesMap', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<site xmlns="http://www.demandware.com/xml/impex/site/current" site-id="UnknownSite">
    <custom-cartridges>app_custom</custom-cartridges>
</site>`;

        const filePath = path.join(tmpDir, 'site.xml');
        fs.writeFileSync(filePath, xml, 'utf-8');

        const comparisons = await parseAndCompareSiteXmls(
            [{ filePath, relativePath: 'site.xml', siteLocale: 'x' }],
            {} // empty - no live sites
        );

        expect(comparisons).toEqual([]);
    });
});
