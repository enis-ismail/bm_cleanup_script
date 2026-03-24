import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dependencies before importing the module under test
vi.mock('../../../src/io/util.js', () => ({
    getResultsPath: vi.fn((realm, instanceType) => {
        if (instanceType) {
            return `/mock/results/${instanceType}/${realm}`;
        }
        return `/mock/results/development/${realm}`;
    }),
    ensureResultsDir: vi.fn(() => '/mock/results/development/ALL_REALMS'),
    findAllUsageFiles: vi.fn(() => []),
    findAllMatrixFiles: vi.fn(() => [])
}));

vi.mock('../../../src/io/csv.js', () => ({
    parseCSVToNestedArray: vi.fn(() => [])
}));

vi.mock('../../../src/config/constants.js', () => ({
    FILE_PATTERNS: {
        PREFERENCES_FOR_DELETION: '_preferences_for_deletion.txt',
        PREFERENCE_REFERENCES: '_preference_references.json',
        PREFERENCES_MATRIX: '_preferences_matrix.csv',
        PREFERENCES_USAGE: '_preferences_usage.csv'
    },
    IDENTIFIERS: {
        ALL_REALMS: 'ALL_REALMS',
        SITE_PREFERENCES: 'SitePreferences'
    },
    TIER_DESCRIPTIONS: {
        P1: 'Safe to Delete — No code references, no values',
        P2: 'Likely Safe — No code references, has values',
        P3: 'Deprecated Code Only — No values',
        P4: 'Deprecated Code + Values',
        P5: 'Realm-Specific — Active code not on all realms'
    }
}));

vi.mock('../../../src/commands/setup/helpers/blacklistHelper.js', () => ({
    isBlacklisted: vi.fn(() => false)
}));

vi.mock('../../../src/commands/setup/helpers/whitelistHelper.js', () => ({
    isWhitelisted: vi.fn(() => false)
}));

import { buildInspectionReport, writeInspectionReport } from
    '../../../src/commands/preferences/helpers/inspectHelper.js';
import {
    findAllUsageFiles, findAllMatrixFiles, ensureResultsDir, getResultsPath
} from '../../../src/io/util.js';
import { parseCSVToNestedArray } from '../../../src/io/csv.js';
import { isBlacklisted } from
    '../../../src/commands/setup/helpers/blacklistHelper.js';
import { isWhitelisted } from
    '../../../src/commands/setup/helpers/whitelistHelper.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a fake deletion file content string with preferences in tier sections.
 */
function buildDeletionFileContent(sections = {}) {
    const lines = [
        'Site Preferences — Deletion Candidates for TEST',
        'Generated: 2026-03-24T00:00:00.000Z',
        '',
        '================================================================================'
    ];

    for (const [tier, prefs] of Object.entries(sections)) {
        lines.push('');
        lines.push(`--- [${tier}] Section Header --- [${prefs.length} preferences]`);
        for (const pref of prefs) {
            lines.push(pref);
        }
        lines.push('');
        lines.push('================================================================================');
    }

    return lines.join('\n');
}

/**
 * Build usage CSV data as a nested array (mock parseCSVToNestedArray output).
 */
function buildUsageCSVData(rows = []) {
    const headers = ['groupId', 'preferenceId', 'defaultValue', 'description',
        'type', 'value_Site1', 'value_Site2'];
    return [headers, ...rows];
}

/**
 * Build matrix CSV data as a nested array.
 */
function buildMatrixCSVData(rows = []) {
    const headers = ['preferenceId', 'defaultValue', 'Site1', 'Site2', 'Site3'];
    return [headers, ...rows];
}

// ============================================================================
// TESTS
// ============================================================================

describe('inspectHelper', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-test-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
        isBlacklisted.mockReturnValue(false);
        isWhitelisted.mockReturnValue(false);
        findAllUsageFiles.mockReturnValue([]);
        findAllMatrixFiles.mockReturnValue([]);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    // ====================================================================
    // buildInspectionReport
    // ====================================================================

    describe('buildInspectionReport', () => {
        it('includes preference ID and realms in header', () => {
            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05', 'APAC']
            });

            expect(report).toContain('PREFERENCE INSPECTION: c_testPref');
            expect(report).toContain('Instance Type: development');
            expect(report).toContain('Realms: EU05, APAC');
        });

        it('shows whitelist status when whitelisted', () => {
            isWhitelisted.mockReturnValue(true);

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('Whitelisted: YES');
            expect(report).toContain('Blacklisted: no');
        });

        it('shows blacklist status when blacklisted', () => {
            isBlacklisted.mockReturnValue(true);

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('Blacklisted: YES (protected');
        });

        it('shows deletion tier from deletion file', () => {
            const deletionContent = buildDeletionFileContent({
                P2: ['c_testPref  |  has default value  |  sites with values: 2']
            });
            const deletionDir = path.join(tmpDir, 'EU05');
            fs.mkdirSync(deletionDir, { recursive: true });
            fs.writeFileSync(
                path.join(deletionDir, 'EU05_preferences_for_deletion.txt'),
                deletionContent
            );

            getResultsPath.mockReturnValue(deletionDir);

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('Deletion Tier: [P2]');
            expect(report).toContain('Likely Safe');
        });

        it('shows N/A tier when preference is not a deletion candidate', () => {
            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain(
                'Deletion Tier: N/A (not a deletion candidate on this realm)'
            );
        });

        it('extracts data from usage CSV when available', () => {
            findAllUsageFiles.mockReturnValue([
                { realm: 'EU05', usageFile: '/mock/usage.csv' }
            ]);
            parseCSVToNestedArray.mockReturnValue(
                buildUsageCSVData([
                    ['TestGroup', 'c_testPref', 'myDefault', 'A test pref',
                        'string', 'val1', '']
                ])
            );

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('Type:          string');
            expect(report).toContain('Description:   A test pref');
            expect(report).toContain('Default Value: myDefault');
            expect(report).toContain('Group:         TestGroup');
            expect(report).toContain('Site1: val1');
        });

        it('falls back to matrix CSV when usage CSV has no data', () => {
            findAllUsageFiles.mockReturnValue([
                { realm: 'EU05', usageFile: '/mock/usage.csv' }
            ]);
            parseCSVToNestedArray
                .mockReturnValueOnce(
                    buildUsageCSVData([]) // usage CSV: no matching row
                )
                .mockReturnValueOnce(
                    buildMatrixCSVData([
                        ['c_testPref', '', '', 'X', '']
                    ])
                );

            findAllMatrixFiles.mockReturnValue([
                { realm: 'EU05', matrixFile: '/mock/matrix.csv' }
            ]);

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('Default Value: (none)');
            expect(report).toContain('Site2: (has value)');
            expect(report).toContain('[Source: matrix CSV');
        });

        it('shows matrix fallback with default value when present', () => {
            findAllUsageFiles.mockReturnValue([
                { realm: 'APAC', usageFile: '/mock/usage.csv' }
            ]);
            parseCSVToNestedArray
                .mockReturnValueOnce(buildUsageCSVData([]))
                .mockReturnValueOnce(
                    buildMatrixCSVData([
                        ['c_testPref', 'hello_default', '', '', '']
                    ])
                );

            findAllMatrixFiles.mockReturnValue([
                { realm: 'APAC', matrixFile: '/mock/matrix.csv' }
            ]);

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['APAC']
            });

            expect(report).toContain('Default Value: hello_default');
            expect(report).toContain('(no site-level values set)');
        });

        it('shows "no data" message when neither CSV has the preference', () => {
            findAllUsageFiles.mockReturnValue([
                { realm: 'EU05', usageFile: '/mock/usage.csv' }
            ]);
            parseCSVToNestedArray.mockReturnValue(buildUsageCSVData([]));
            findAllMatrixFiles.mockReturnValue([]);

            const report = buildInspectionReport({
                preferenceId: 'c_unknown',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain(
                '[No data found in results files'
            );
        });

        it('shows "no data" message for P1 tier when data is missing', () => {
            // Previously P1 tiers silently skipped the "no data" message.
            // Now it should always show something.
            findAllUsageFiles.mockReturnValue([]);
            findAllMatrixFiles.mockReturnValue([]);

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('[No data found in results files');
        });

        it('shows code references grouped by cartridge', () => {
            const refsDir = path.join(tmpDir, 'ALL_REALMS');
            fs.mkdirSync(refsDir, { recursive: true });
            fs.writeFileSync(
                path.join(refsDir, 'development_preference_references.json'),
                JSON.stringify({
                    preferences: {
                        c_testPref: [
                            {
                                file: 'scripts/test.js',
                                line: 10,
                                text: 'custom.c_testPref',
                                cartridge: 'app_custom'
                            },
                            {
                                file: 'scripts/other.js',
                                line: 25,
                                text: 'custom.c_testPref',
                                cartridge: 'app_custom'
                            }
                        ]
                    }
                })
            );

            getResultsPath.mockImplementation((realm, instanceType) => {
                if (realm === 'ALL_REALMS') {
                    return refsDir;
                }
                return path.join(tmpDir, realm);
            });

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('Cartridges: app_custom');
            expect(report).toContain('Total matches: 2');
            expect(report).toContain('app_custom:');
            expect(report).toContain('scripts/test.js:10');
        });

        it('shows no matches when code references file exists but pref not found', () => {
            const refsDir = path.join(tmpDir, 'ALL_REALMS');
            fs.mkdirSync(refsDir, { recursive: true });
            fs.writeFileSync(
                path.join(refsDir, 'development_preference_references.json'),
                JSON.stringify({ preferences: {} })
            );

            getResultsPath.mockImplementation((realm, instanceType) => {
                if (realm === 'ALL_REALMS') {
                    return refsDir;
                }
                return path.join(tmpDir, realm);
            });

            const report = buildInspectionReport({
                preferenceId: 'c_notReferenced',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('Cartridges: (none)');
            expect(report).toContain('Total matches: 0');
        });

        it('shows references file not found message when missing', () => {
            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05']
            });

            expect(report).toContain('[References file not found');
        });

        it('handles multiple realms with different tiers', () => {
            // Set up deletion file for APAC only
            const apacDir = path.join(tmpDir, 'APAC');
            fs.mkdirSync(apacDir, { recursive: true });
            fs.writeFileSync(
                path.join(apacDir, 'APAC_preferences_for_deletion.txt'),
                buildDeletionFileContent({ P1: ['c_testPref'] })
            );

            getResultsPath.mockImplementation((realm, instanceType) => {
                if (realm === 'APAC') {
                    return apacDir;
                }
                if (realm === 'ALL_REALMS') {
                    return path.join(tmpDir, 'ALL_REALMS');
                }
                return path.join(tmpDir, realm);
            });

            const report = buildInspectionReport({
                preferenceId: 'c_testPref',
                instanceType: 'development',
                realms: ['EU05', 'APAC']
            });

            expect(report).toContain('Realm: EU05');
            expect(report).toContain(
                'Deletion Tier: N/A (not a deletion candidate on this realm)'
            );
            expect(report).toContain('Realm: APAC');
            expect(report).toContain('Deletion Tier: [P1]');
        });
    });

    // ====================================================================
    // writeInspectionReport
    // ====================================================================

    describe('writeInspectionReport', () => {
        it('writes report to file and returns path', () => {
            ensureResultsDir.mockReturnValue(tmpDir);

            const outputPath = writeInspectionReport(
                'Test report content', 'development'
            );

            expect(outputPath).toBe(
                path.join(tmpDir, 'preference_inspection.txt')
            );
            expect(fs.readFileSync(outputPath, 'utf-8')).toBe(
                'Test report content'
            );
        });
    });
});
