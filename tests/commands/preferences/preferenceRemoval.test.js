import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dependencies before importing the module under test
vi.mock('../../../src/io/util.js', () => ({
    ensureResultsDir: vi.fn(),
    openFileInVSCode: vi.fn()
}));

vi.mock('../../../src/commands/setup/helpers/blacklistHelper.js', () => ({
    filterBlacklisted: vi.fn((ids) => ({ allowed: ids, blocked: [] }))
}));

vi.mock('../../../src/commands/setup/helpers/whitelistHelper.js', () => ({
    filterWhitelisted: vi.fn((ids) => ({ allowed: ids, blocked: [] }))
}));

import {
    loadRealmPreferencesForDeletion,
    buildRealmPreferenceMapFromFiles,
    buildCrossRealmPreferenceMap,
    generateDeletionSummary
} from '../../../src/commands/preferences/helpers/preferenceRemoval.js';
import { ensureResultsDir } from '../../../src/io/util.js';
import { filterBlacklisted } from '../../../src/commands/setup/helpers/blacklistHelper.js';
import { filterWhitelisted } from '../../../src/commands/setup/helpers/whitelistHelper.js';

// ============================================================================
// Tier Parsing via loadRealmPreferencesForDeletion
// ============================================================================

describe('loadRealmPreferencesForDeletion', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-removal-'));
        ensureResultsDir.mockReturnValue(tmpDir);
        filterBlacklisted.mockImplementation((ids) => ({ allowed: ids, blocked: [] }));
        filterWhitelisted.mockImplementation((ids) => ({ allowed: ids, blocked: [] }));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('returns null when deletion file does not exist', () => {
        const result = loadRealmPreferencesForDeletion('EU05', 'development');
        expect(result).toBeNull();
    });

    it('parses all P1-P5 tiers from a deletion file', () => {
        const content = [
            '=== Preferences for Deletion ===',
            '',
            '--- [P1] Safe to Delete ---',
            'c_unusedPrefA',
            'c_unusedPrefB',
            '',
            '--- [P2] No Code Refs, Has Values ---',
            'c_valueOnlyPref',
            '',
            '--- [P3] Deprecated Code Only ---',
            'c_deprecatedPref',
            '',
            '--- [P4] Deprecated + Values ---',
            'c_deprecatedValuePref',
            '',
            '--- [P5] Realm-Specific ---',
            'c_realmSpecific',
            '',
            '========================='
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = loadRealmPreferencesForDeletion('EU05', 'development');

        expect(result).not.toBeNull();
        expect(result.allowed).toHaveLength(6);
        expect(result.allowed.map(p => p.id)).toEqual([
            'c_unusedPrefA', 'c_unusedPrefB', 'c_valueOnlyPref',
            'c_deprecatedPref', 'c_deprecatedValuePref', 'c_realmSpecific'
        ]);
    });

    it('respects maxTier filtering (cascading)', () => {
        const content = [
            '--- [P1] Safe to Delete ---',
            'c_p1Pref',
            '',
            '--- [P2] No Code Refs ---',
            'c_p2Pref',
            '',
            '--- [P3] Deprecated Only ---',
            'c_p3Pref',
            '',
            '--- [P4] Deprecated + Values ---',
            'c_p4Pref',
            '',
            '--- [P5] Realm-Specific ---',
            'c_p5Pref'
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = loadRealmPreferencesForDeletion('EU05', 'development', { maxTier: 'P2' });

        expect(result.allowed).toHaveLength(2);
        expect(result.allowed.map(p => p.id)).toEqual(['c_p1Pref', 'c_p2Pref']);
    });

    it('assigns correct tier labels to preferences', () => {
        const content = [
            '--- [P1] Safe ---',
            'c_a',
            '--- [P3] Deprecated ---',
            'c_b'
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = loadRealmPreferencesForDeletion('EU05', 'development');

        expect(result.allowed[0]).toEqual({ id: 'c_a', tier: 'P1' });
        expect(result.allowed[1]).toEqual({ id: 'c_b', tier: 'P3' });
    });

    it('returns null when file has no preferences', () => {
        const content = [
            '=== Preferences for Deletion ===',
            '',
            '========================='
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = loadRealmPreferencesForDeletion('EU05', 'development');
        expect(result).toBeNull();
    });

    it('stops at blacklist section header', () => {
        const content = [
            '--- [P1] Safe ---',
            'c_included',
            '',
            '--- Blacklisted Preferences (Protected) ---',
            'c_shouldNotInclude'
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = loadRealmPreferencesForDeletion('EU05', 'development');

        expect(result.allowed).toHaveLength(1);
        expect(result.allowed[0].id).toBe('c_included');
    });

    it('handles legacy header format', () => {
        const content = [
            '--- Preferences for Deletion ---',
            'c_legacyPref1',
            'c_legacyPref2'
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = loadRealmPreferencesForDeletion('EU05', 'development');

        expect(result.allowed).toHaveLength(2);
        expect(result.allowed.map(p => p.id)).toEqual(['c_legacyPref1', 'c_legacyPref2']);
    });

    it('reports blacklisted preferences as blocked', () => {
        const content = [
            '--- [P1] Safe ---',
            'c_allowed',
            'c_blocked'
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        filterWhitelisted.mockImplementation((ids) => ({ allowed: ids, blocked: [] }));
        filterBlacklisted.mockImplementation((ids) => ({
            allowed: ids.filter(id => id !== 'c_blocked'),
            blocked: ['c_blocked']
        }));

        const result = loadRealmPreferencesForDeletion('EU05', 'development');

        expect(result.allowed).toHaveLength(1);
        expect(result.allowed[0].id).toBe('c_allowed');
        expect(result.blocked).toEqual(['c_blocked']);
    });

    it('handles pipe-separated metadata after preference ID', () => {
        const content = [
            '--- [P1] Safe ---',
            'c_myPref  |  No code refs, no values'
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = loadRealmPreferencesForDeletion('EU05', 'development');

        expect(result.allowed).toHaveLength(1);
        expect(result.allowed[0].id).toBe('c_myPref');
    });
});

// ============================================================================
// buildRealmPreferenceMapFromFiles
// ============================================================================

describe('buildRealmPreferenceMapFromFiles', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-map-'));
        ensureResultsDir.mockReturnValue(tmpDir);
        filterBlacklisted.mockImplementation((ids) => ({ allowed: ids, blocked: [] }));
        filterWhitelisted.mockImplementation((ids) => ({ allowed: ids, blocked: [] }));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('builds a map with preferences from multiple realms', () => {
        const content = [
            '--- [P1] Safe ---',
            'c_prefA',
            'c_prefB'
        ].join('\n');

        // Both realms use the same tmpDir (mocked ensureResultsDir)
        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );
        fs.writeFileSync(
            path.join(tmpDir, 'APAC_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = buildRealmPreferenceMapFromFiles(['EU05', 'APAC'], 'development');

        expect(result.realmPreferenceMap.get('EU05')).toEqual(['c_prefA', 'c_prefB']);
        expect(result.realmPreferenceMap.get('APAC')).toEqual(['c_prefA', 'c_prefB']);
        expect(result.missingRealms).toEqual([]);
    });

    it('marks realms with missing files as missing', () => {
        const result = buildRealmPreferenceMapFromFiles(['EU05', 'MISSING'], 'development');

        expect(result.realmPreferenceMap.get('EU05')).toEqual([]);
        expect(result.realmPreferenceMap.get('MISSING')).toEqual([]);
        expect(result.missingRealms).toContain('EU05');
        expect(result.missingRealms).toContain('MISSING');
    });

    it('collects blacklisted IDs across all realms', () => {
        const content = [
            '--- [P1] Safe ---',
            'c_allowed',
            'c_blocked1'
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        filterBlacklisted.mockImplementation((ids) => ({
            allowed: ids.filter(id => id !== 'c_blocked1'),
            blocked: ['c_blocked1']
        }));

        const result = buildRealmPreferenceMapFromFiles(['EU05'], 'development');

        expect(result.blockedByBlacklist).toEqual(['c_blocked1']);
    });

    it('applies maxTier to each realm', () => {
        const content = [
            '--- [P1] Safe ---',
            'c_p1',
            '--- [P3] Deprecated ---',
            'c_p3'
        ].join('\n');

        fs.writeFileSync(
            path.join(tmpDir, 'EU05_preferences_for_deletion.txt'),
            content, 'utf-8'
        );

        const result = buildRealmPreferenceMapFromFiles(['EU05'], 'development', { maxTier: 'P1' });

        expect(result.realmPreferenceMap.get('EU05')).toEqual(['c_p1']);
    });
});

// ============================================================================
// generateDeletionSummary
// ============================================================================

describe('generateDeletionSummary', () => {
    it('counts total preferences', () => {
        const summary = generateDeletionSummary(['enableSearch', 'enableFeature', 'maxResults']);
        expect(summary.total).toBe(3);
    });

    it('groups by prefix', () => {
        const prefs = ['enableSearch', 'enableFeature', 'enablePayment', 'maxResults', 'maxItems'];
        const summary = generateDeletionSummary(prefs);

        expect(summary.total).toBe(5);
        expect(summary.topPrefixes.length).toBeGreaterThan(0);

        // 'enable' prefix should have count 3
        const enableEntry = summary.topPrefixes.find(([prefix]) => prefix === 'enable');
        expect(enableEntry).toBeDefined();
        expect(enableEntry[1]).toBe(3);
    });

    it('returns empty topPrefixes for empty input', () => {
        const summary = generateDeletionSummary([]);
        expect(summary.total).toBe(0);
        expect(summary.topPrefixes).toEqual([]);
    });

    it('limits to top 10 prefixes', () => {
        const prefs = Array.from({ length: 50 }, (_, i) => `prefix${i}Value`);
        const summary = generateDeletionSummary(prefs);
        expect(summary.topPrefixes.length).toBeLessThanOrEqual(10);
    });
});
