import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../../src/io/util.js', () => ({
    ensureResultsDir: vi.fn(() => '/mock/results/EU05')
}));

vi.mock('../../../../src/index.js', () => ({
    getValidationConfig: vi.fn(() => ({
        ignoreBmCartridges: false
    }))
}));

vi.mock('../../../../src/config/constants.js', () => ({
    FILE_PATTERNS: {
        CARTRIDGE_COMPARISON: '_cartridge_comparison.txt'
    }
}));

vi.mock('../../../../src/scripts/loggingScript/log.js', () => ({
    logError: vi.fn()
}));

import {
    compareCartridges,
    formatComparisonResults,
    exportComparisonToFile
} from '../../../../src/commands/cartridges/helpers/cartridgeComparison.js';
import { ensureResultsDir } from '../../../../src/io/util.js';
import { getValidationConfig } from '../../../../src/index.js';
import { logError } from '../../../../src/scripts/loggingScript/log.js';

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartridge-comparison-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

// ============================================================================
// compareCartridges
// ============================================================================

describe('compareCartridges', () => {
    it('returns correct totals for discovered cartridges', () => {
        const discovered = ['app_storefront', 'int_payment', 'app_custom'];
        const sites = [
            { name: 'SiteA', cartridges: ['app_storefront', 'app_custom'] },
            { name: 'SiteB', cartridges: ['app_storefront'] }
        ];

        const result = compareCartridges(discovered, sites);

        expect(result.total).toBe(3);
        expect(result.used).toContain('app_storefront');
        expect(result.used).toContain('app_custom');
        expect(result.unused).toContain('int_payment');
    });

    it('marks all cartridges as unused when no sites reference them', () => {
        const discovered = ['cart_a', 'cart_b'];
        const sites = [
            { name: 'SiteA', cartridges: ['other_cart'] }
        ];

        const result = compareCartridges(discovered, sites);

        expect(result.used).toEqual([]);
        expect(result.unused).toEqual(['cart_a', 'cart_b']);
    });

    it('marks all cartridges as used when all are referenced', () => {
        const discovered = ['cart_a', 'cart_b'];
        const sites = [
            { name: 'SiteA', cartridges: ['cart_a', 'cart_b'] }
        ];

        const result = compareCartridges(discovered, sites);

        expect(result.used).toEqual(['cart_a', 'cart_b']);
        expect(result.unused).toEqual([]);
    });

    it('handles empty discovered cartridges', () => {
        const result = compareCartridges([], [{ name: 'SiteA', cartridges: ['cart_a'] }]);

        expect(result.total).toBe(0);
        expect(result.used).toEqual([]);
        expect(result.unused).toEqual([]);
        expect(result.detail).toEqual([]);
    });

    it('handles empty sites array', () => {
        const result = compareCartridges(['cart_a'], []);

        expect(result.total).toBe(1);
        expect(result.used).toEqual([]);
        expect(result.unused).toEqual(['cart_a']);
    });

    it('handles sites without cartridges property', () => {
        const discovered = ['cart_a'];
        const sites = [{ name: 'SiteA' }];

        const result = compareCartridges(discovered, sites);

        expect(result.unused).toEqual(['cart_a']);
    });

    it('populates detail with usage count and site names', () => {
        const discovered = ['app_storefront'];
        const sites = [
            { name: 'SiteA', cartridges: ['app_storefront'] },
            { name: 'SiteB', cartridges: ['app_storefront'] }
        ];

        const result = compareCartridges(discovered, sites);
        const detail = result.detail[0];

        expect(detail.name).toBe('app_storefront');
        expect(detail.used).toBe(true);
        expect(detail.usageCount).toBe(2);
        expect(detail.sites).toEqual(['SiteA', 'SiteB']);
    });

    it('filters bm_ cartridges when ignoreBmCartridges is true', () => {
        getValidationConfig.mockReturnValue({ ignoreBmCartridges: true });

        const discovered = ['bm_admin', 'app_storefront'];
        const sites = [
            { name: 'SiteA', cartridges: ['bm_admin', 'app_storefront'] }
        ];

        const result = compareCartridges(discovered, sites);

        // bm_admin is in sites but should not be counted as used since bm_ are filtered
        expect(result.used).not.toContain('bm_admin');
        expect(result.used).toContain('app_storefront');
    });

    it('includes bm_ cartridges when ignoreBmCartridges is false', () => {
        getValidationConfig.mockReturnValue({ ignoreBmCartridges: false });

        const discovered = ['bm_admin', 'app_storefront'];
        const sites = [
            { name: 'SiteA', cartridges: ['bm_admin', 'app_storefront'] }
        ];

        const result = compareCartridges(discovered, sites);

        expect(result.used).toContain('bm_admin');
        expect(result.used).toContain('app_storefront');
    });

    it('returns unused detail entry for cartridge not in any site', () => {
        const discovered = ['orphan_cart'];
        const sites = [
            { name: 'SiteA', cartridges: ['other_cart'] }
        ];

        const result = compareCartridges(discovered, sites);
        const detail = result.detail[0];

        expect(detail.name).toBe('orphan_cart');
        expect(detail.used).toBe(false);
        expect(detail.usageCount).toBe(0);
        expect(detail.sites).toEqual([]);
    });
});

// ============================================================================
// formatComparisonResults
// ============================================================================

describe('formatComparisonResults', () => {
    it('formats results with used and unused cartridges', () => {
        const comparisonResult = {
            total: 3,
            used: ['app_storefront', 'app_custom'],
            unused: ['int_old'],
            detail: [
                { name: 'app_storefront', used: true, usageCount: 2, sites: ['SiteA', 'SiteB'] },
                { name: 'app_custom', used: true, usageCount: 1, sites: ['SiteA'] },
                { name: 'int_old', used: false, usageCount: 0, sites: [] }
            ]
        };

        const output = formatComparisonResults(comparisonResult);

        expect(output).toContain('Total Discovered: 3');
        expect(output).toContain('Used on Sites: 2');
        expect(output).toContain('Deprecated (Unused): 1');
        expect(output).toContain('[X] int_old');
        expect(output).toContain('[+] app_storefront (used on 2 site(s))');
        expect(output).toContain('Sites: SiteA, SiteB');
    });

    it('omits deprecated section when no unused cartridges', () => {
        const comparisonResult = {
            total: 1,
            used: ['app_storefront'],
            unused: [],
            detail: [
                { name: 'app_storefront', used: true, usageCount: 1, sites: ['SiteA'] }
            ]
        };

        const output = formatComparisonResults(comparisonResult);

        expect(output).not.toContain('Potentially Deprecated');
        expect(output).toContain('Active Cartridges');
    });

    it('omits active section when no used cartridges', () => {
        const comparisonResult = {
            total: 1,
            used: [],
            unused: ['orphan'],
            detail: [
                { name: 'orphan', used: false, usageCount: 0, sites: [] }
            ]
        };

        const output = formatComparisonResults(comparisonResult);

        expect(output).toContain('Potentially Deprecated');
        expect(output).not.toContain('Active Cartridges');
    });

    it('handles empty comparison result', () => {
        const comparisonResult = {
            total: 0,
            used: [],
            unused: [],
            detail: []
        };

        const output = formatComparisonResults(comparisonResult);

        expect(output).toContain('Total Discovered: 0');
        expect(output).toContain('Used on Sites: 0');
        expect(output).toContain('Deprecated (Unused): 0');
    });
});

// ============================================================================
// exportComparisonToFile
// ============================================================================

describe('exportComparisonToFile', () => {
    it('writes comparison results to file and returns path', async () => {
        ensureResultsDir.mockReturnValue(tmpDir);
        const comparisonResult = {
            total: 2,
            used: ['app_storefront'],
            unused: ['int_old'],
            detail: [
                { name: 'app_storefront', used: true, usageCount: 1, sites: ['SiteA'] },
                { name: 'int_old', used: false, usageCount: 0, sites: [] }
            ]
        };

        const filePath = await exportComparisonToFile(comparisonResult, 'EU05');

        expect(filePath).toContain('EU05_cartridge_comparison.txt');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Total Discovered: 2');
        expect(content).toContain('[X] int_old');
    });

    it('uses instanceTypeOverride when provided', async () => {
        ensureResultsDir.mockReturnValue(tmpDir);
        const comparisonResult = {
            total: 0,
            used: [],
            unused: [],
            detail: []
        };

        await exportComparisonToFile(comparisonResult, 'EU05', 'staging');

        expect(ensureResultsDir).toHaveBeenCalledWith('EU05', 'staging');
    });

    it('throws and logs error when write fails', async () => {
        ensureResultsDir.mockReturnValue('/non/existent/path');
        const comparisonResult = {
            total: 0,
            used: [],
            unused: [],
            detail: []
        };

        await expect(exportComparisonToFile(comparisonResult, 'EU05'))
            .rejects.toThrow();
        expect(logError).toHaveBeenCalled();
    });
});
