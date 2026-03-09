import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
    parseUnusedPreferences,
    parseXMLGroupDefinitions,
    generateSitePreferencesJSON,
    createLogger,
    generate
} from '../../../src/commands/preferences/helpers/generateSitePreferences.js';

// ============================================================================
// Helpers
// ============================================================================

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-site-prefs-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

// ============================================================================
// createLogger
// ============================================================================

describe('createLogger', () => {
    it('creates silent logger when verbose is false', () => {
        const logger = createLogger(false);
        logger.info('test');
        logger.section('test');
        logger.success('test');
        logger.data('test');
        expect(console.log).not.toHaveBeenCalled();
    });

    it('creates verbose logger when verbose is true', () => {
        const logger = createLogger(true);
        logger.info('test');
        expect(console.log).toHaveBeenCalled();
    });

    it('always logs errors regardless of verbose', () => {
        const logger = createLogger(false);
        logger.error('oops');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('oops'));
    });
});

// ============================================================================
// parseUnusedPreferences
// ============================================================================

describe('parseUnusedPreferences', () => {
    it('parses priority-header format', () => {
        const content = [
            'Header info',
            '',
            '--- [P1] Safe to Delete --- 2 preferences',
            'c_prefA',
            'c_prefB',
            '',
            '--- [P2] Likely Safe --- 1 preferences',
            'c_prefC',
            '',
            '--- Blacklisted Preferences (Protected) ---',
            'c_protected'
        ].join('\n');

        const filePath = path.join(tmpDir, 'unused.txt');
        fs.writeFileSync(filePath, content);

        const result = parseUnusedPreferences(filePath);
        expect(result).toEqual(['c_prefA', 'c_prefB', 'c_prefC']);
    });

    it('parses legacy format', () => {
        const content = [
            '--- Preference IDs ---',
            'c_legacyA',
            'c_legacyB'
        ].join('\n');

        const filePath = path.join(tmpDir, 'unused.txt');
        fs.writeFileSync(filePath, content);

        const result = parseUnusedPreferences(filePath);
        expect(result).toEqual(['c_legacyA', 'c_legacyB']);
    });

    it('parses new format with realm info', () => {
        const content = [
            '--- [P1] Safe to Delete ---',
            'c_prefA  |  realms: ALL',
            'c_prefB  |  realms: EU05, APAC'
        ].join('\n');

        const filePath = path.join(tmpDir, 'unused.txt');
        fs.writeFileSync(filePath, content);

        const result = parseUnusedPreferences(filePath);
        expect(result).toEqual(['c_prefA', 'c_prefB']);
    });

    it('skips header lines and separators', () => {
        const content = [
            '=========================',
            'Site Preferences Header',
            '--- [P1] Safe ---',
            'c_onlyOne',
            '=========================',
        ].join('\n');

        const filePath = path.join(tmpDir, 'unused.txt');
        fs.writeFileSync(filePath, content);

        const result = parseUnusedPreferences(filePath);
        expect(result).toEqual(['c_onlyOne']);
    });

    it('stops at blacklisted section', () => {
        const content = [
            '--- [P1] Safe ---',
            'c_included',
            '--- Blacklisted Preferences (Protected) ---',
            'c_shouldNotBeIncluded'
        ].join('\n');

        const filePath = path.join(tmpDir, 'unused.txt');
        fs.writeFileSync(filePath, content);

        const result = parseUnusedPreferences(filePath);
        expect(result).toEqual(['c_included']);
    });
});

// ============================================================================
// parseXMLGroupDefinitions
// ============================================================================

describe('parseXMLGroupDefinitions', () => {
    it('returns empty map when file does not exist', () => {
        const result = parseXMLGroupDefinitions('/nonexistent.xml');
        expect(result).toEqual({});
    });

    it('parses SitePreferences group definitions from XML', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <group-definitions>
            <attribute-group group-id="General">
                <attribute attribute-id="c_prefA"/>
                <attribute attribute-id="c_prefB"/>
            </attribute-group>
            <attribute-group group-id="Payment">
                <attribute attribute-id="c_paymentPref"/>
            </attribute-group>
        </group-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml);

        const result = parseXMLGroupDefinitions(filePath);
        expect(result).toEqual({
            c_prefA: 'General',
            c_prefB: 'General',
            c_paymentPref: 'Payment'
        });
    });

    it('returns empty map when no SitePreferences type-extension found', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="Product">
        <group-definitions>
            <attribute-group group-id="Test">
                <attribute attribute-id="c_test"/>
            </attribute-group>
        </group-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml);

        const result = parseXMLGroupDefinitions(filePath);
        expect(result).toEqual({});
    });

    it('returns empty map when no group-definitions section', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <custom-attribute-definitions>
            <attribute-definition attribute-id="c_test"/>
        </custom-attribute-definitions>
    </type-extension>
</metadata>`;

        const filePath = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(filePath, xml);

        const result = parseXMLGroupDefinitions(filePath);
        expect(result).toEqual({});
    });
});

// ============================================================================
// generateSitePreferencesJSON
// ============================================================================

describe('generateSitePreferencesJSON', () => {
    it('generates attributes from CSV data', () => {
        const unusedPrefIds = ['c_feature'];
        const csvData = {
            c_feature: {
                groupId: 'General',
                preferenceId: 'c_feature',
                defaultValue: 'true',
                description: 'Enable feature',
                type: 'boolean',
                values: { SiteUS: 'true' }
            }
        };
        const groupMap = { c_feature: 'General' };

        const { result, csvMatches, minimal } = generateSitePreferencesJSON(
            unusedPrefIds, csvData, groupMap, { realm: 'EU05' }
        );

        expect(csvMatches).toBe(1);
        expect(minimal).toBe(0);
        expect(result.attributes).toHaveLength(1);
        expect(result.attributes[0].id).toBe('c_feature');
        expect(result.attributes[0].value_type).toBe('boolean');
        expect(result.attribute_groups).toHaveLength(1);
        expect(result.attribute_groups[0].group_id).toBe('General');
        expect(result.site_values).toHaveProperty('c_feature');
    });

    it('generates minimal attributes for preferences not in CSV', () => {
        const unusedPrefIds = ['c_unknown'];
        const csvData = {};
        const groupMap = {};

        const { result, csvMatches, minimal } = generateSitePreferencesJSON(
            unusedPrefIds, csvData, groupMap
        );

        expect(csvMatches).toBe(0);
        expect(minimal).toBe(1);
        expect(result.attributes).toHaveLength(1);
        expect(result.attributes[0].id).toBe('c_unknown');
        expect(result.attributes[0].value_type).toBe('string');
    });

    it('assigns group from XML map for minimal attributes', () => {
        const unusedPrefIds = ['c_unknown'];
        const csvData = {};
        const groupMap = { c_unknown: 'XMLGroup' };

        const { result } = generateSitePreferencesJSON(
            unusedPrefIds, csvData, groupMap
        );

        expect(result.attribute_groups).toHaveLength(1);
        expect(result.attribute_groups[0].group_id).toBe('XMLGroup');
        expect(result.attribute_groups[0].attributes).toContain('c_unknown');
    });

    it('handles mixed CSV and non-CSV preferences', () => {
        const unusedPrefIds = ['c_inCsv', 'c_notInCsv'];
        const csvData = {
            c_inCsv: {
                groupId: 'G1',
                preferenceId: 'c_inCsv',
                defaultValue: '',
                description: '',
                type: 'string',
                values: {}
            }
        };
        const groupMap = {};

        const { result, csvMatches, minimal } = generateSitePreferencesJSON(
            unusedPrefIds, csvData, groupMap
        );

        expect(csvMatches).toBe(1);
        expect(minimal).toBe(1);
        expect(result.attributes).toHaveLength(2);
    });

    it('uses config realm and instance type in output', () => {
        const { result } = generateSitePreferencesJSON(
            [], {}, {},
            { realm: 'APAC', instanceType: 'staging', objectType: 'TestObj' }
        );

        expect(result.realm).toBe('APAC');
        expect(result.instance_type).toBe('staging');
        expect(result.object_type).toBe('TestObj');
    });

    it('does not include site_values when preference has no values', () => {
        const csvData = {
            c_noValues: {
                groupId: 'G1',
                preferenceId: 'c_noValues',
                defaultValue: '',
                description: '',
                type: 'string',
                values: {}
            }
        };

        const { result } = generateSitePreferencesJSON(
            ['c_noValues'], csvData, {}
        );

        expect(result.site_values).not.toHaveProperty('c_noValues');
    });
});

// ============================================================================
// generate (integration)
// ============================================================================

describe('generate', () => {
    it('returns success with stats when files exist', async () => {
        // Create unused preferences file
        const unusedFile = path.join(tmpDir, 'unused.txt');
        fs.writeFileSync(unusedFile, [
            '--- [P1] Safe ---',
            'c_testPref'
        ].join('\n'));

        // Create CSV file
        const csvFile = path.join(tmpDir, 'usage.csv');
        fs.writeFileSync(csvFile, [
            'preferenceId,groupId,defaultValue,description,type',
            'c_testPref,General,,Test,string'
        ].join('\n'));

        // Create XML file
        const xmlFile = path.join(tmpDir, 'meta.xml');
        fs.writeFileSync(xmlFile, `<?xml version="1.0"?>
<metadata>
    <type-extension type-id="SitePreferences">
        <group-definitions>
            <attribute-group group-id="General">
                <attribute attribute-id="c_testPref"/>
            </attribute-group>
        </group-definitions>
    </type-extension>
</metadata>`);

        const outputFile = path.join(tmpDir, 'output.json');

        const result = await generate({
            unusedPreferencesFile: unusedFile,
            csvFile,
            xmlMetadataFile: xmlFile,
            outputFile,
            realm: 'test',
            instanceType: 'sandbox',
            verbose: false
        });

        expect(result.success).toBe(true);
        expect(result.stats.total).toBe(1);
        expect(result.outputPath).toBe(outputFile);
        expect(fs.existsSync(outputFile)).toBe(true);
    });

    it('handles missing CSV file gracefully', async () => {
        const unusedFile = path.join(tmpDir, 'unused.txt');
        fs.writeFileSync(unusedFile, '--- [P1] ---\nc_pref');

        const result = await generate({
            unusedPreferencesFile: unusedFile,
            csvFile: '/nonexistent.csv',
            xmlMetadataFile: '/nonexistent.xml',
            outputFile: path.join(tmpDir, 'out.json'),
            verbose: false
        });

        expect(result.success).toBe(true);
        expect(result.stats.minimal).toBe(1);
    });

    it('returns error on failure', async () => {
        const result = await generate({
            unusedPreferencesFile: '/nonexistent/file.txt',
            verbose: false
        });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });

    it('skips file write when outputFile is not specified', async () => {
        const unusedFile = path.join(tmpDir, 'unused.txt');
        fs.writeFileSync(unusedFile, '--- [P1] ---\nc_pref');

        const result = await generate({
            unusedPreferencesFile: unusedFile,
            csvFile: null,
            xmlMetadataFile: '/nonexistent.xml',
            outputFile: null,
            verbose: false
        });

        expect(result.success).toBe(true);
    });
});
