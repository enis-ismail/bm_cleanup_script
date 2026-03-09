import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/index.js', () => ({
    getAvailableRealms: vi.fn(() => ['EU05', 'APAC']),
    getRealmConfig: vi.fn(() => ({
        siteTemplatesPath: 'sites/site_template'
    })),
    getInstanceType: vi.fn(() => 'development')
}));

vi.mock('../../../src/io/util.js', () => ({
    findCartridgeFolders: vi.fn(() => ['app_storefront', 'int_payment']),
    calculateValidationStats: vi.fn(() => ({
        totalFiles: 2,
        totalMatches: 1,
        totalMismatches: 1
    })),
    getSiblingRepositories: vi.fn(() => ['repo-a', 'repo-b'])
}));

vi.mock('../../../src/io/csv.js', () => ({
    exportSitesCartridgesToCSV: vi.fn()
}));

vi.mock('../../../src/commands/cartridges/helpers/cartridgeComparison.js', () => ({
    compareCartridges: vi.fn(() => ({
        total: 2,
        used: ['app_storefront'],
        unused: ['int_payment'],
        detail: []
    })),
    exportComparisonToFile: vi.fn(() => '/mock/results/ALL_REALMS_cartridge_comparison.txt')
}));

vi.mock('../../../src/commands/cartridges/helpers/siteHelper.js', () => ({
    fetchAndTransformSites: vi.fn(),
    fetchSitesFromAllRealms: vi.fn(() => ({
        allSites: [{ name: 'SiteA', cartridges: ['app_storefront'] }],
        realmSummary: [{ realm: 'EU05', siteCount: 1 }]
    }))
}));

vi.mock('../../../src/config/constants.js', () => ({
    LOG_PREFIX: {
        INFO: '[INFO]',
        WARNING: '[WARN]',
        ERROR: '[ERROR]'
    },
    IDENTIFIERS: {
        ALL_REALMS: 'ALL_REALMS'
    }
}));

vi.mock('../../../src/scripts/loggingScript/log.js', () => ({
    logCartridgeList: vi.fn(),
    logCartridgeValidationSummaryHeader: vi.fn(),
    logRealmsProcessed: vi.fn(),
    logCartridgeValidationStats: vi.fn(),
    logCartridgeValidationWarning: vi.fn(),
    logCartridgeValidationSummaryFooter: vi.fn(),
    logSiteXmlValidationSummary: vi.fn()
}));

vi.mock('../../../src/io/siteXmlHelper.js', () => ({
    findSiteXmlFiles: vi.fn(() => []),
    parseAndCompareSiteXmls: vi.fn(() => []),
    exportSiteXmlComparison: vi.fn(() => '/mock/report.txt')
}));

vi.mock('../../../src/commands/prompts/index.js', () => ({
    realmPrompt: vi.fn(() => [{ name: 'realm', type: 'list', choices: [] }]),
    repositoryPrompt: vi.fn(() => [{ name: 'repository', type: 'list', choices: [] }])
}));

vi.mock('../../../src/commands/prompts/commonPrompts.js', () => ({
    resolveRealmScopeSelection: vi.fn()
}));

import {
    registerCartridgeCommands,
    executeListSites,
    executeValidateCartridgesAll,
    executeValidateSiteXml
} from '../../../src/commands/cartridges/cartridges.js';
import { exportSitesCartridgesToCSV } from '../../../src/io/csv.js';
import { findCartridgeFolders, calculateValidationStats } from '../../../src/io/util.js';
import { compareCartridges, exportComparisonToFile } from '../../../src/commands/cartridges/helpers/cartridgeComparison.js';
import { fetchAndTransformSites, fetchSitesFromAllRealms } from '../../../src/commands/cartridges/helpers/siteHelper.js';
import { getAvailableRealms, getRealmConfig } from '../../../src/index.js';
import { findSiteXmlFiles, parseAndCompareSiteXmls, exportSiteXmlComparison } from '../../../src/io/siteXmlHelper.js';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// registerCartridgeCommands
// ============================================================================

describe('registerCartridgeCommands', () => {
    it('registers list-sites, validate-cartridges-all, and validate-site-xml commands', () => {
        const commands = [];
        const mockCommand = {
            command: vi.fn(function (name) {
                const cmd = { name };
                commands.push(cmd);
                return {
                    description: vi.fn().mockReturnValue({
                        action: vi.fn()
                    })
                };
            })
        };

        registerCartridgeCommands(mockCommand);

        expect(mockCommand.command).toHaveBeenCalledTimes(3);
        expect(mockCommand.command).toHaveBeenCalledWith('list-sites');
        expect(mockCommand.command).toHaveBeenCalledWith('validate-cartridges-all');
        expect(mockCommand.command).toHaveBeenCalledWith('validate-site-xml');
    });
});

// ============================================================================
// executeListSites
// ============================================================================

describe('executeListSites', () => {
    it('delegates to exportSitesCartridgesToCSV with the realm', async () => {
        await executeListSites('EU05');

        expect(exportSitesCartridgesToCSV).toHaveBeenCalledWith('EU05');
    });
});

// ============================================================================
// executeValidateCartridgesAll
// ============================================================================

describe('executeValidateCartridgesAll', () => {
    it('validates cartridges end-to-end and returns result', async () => {
        const result = await executeValidateCartridgesAll(
            '/mock/repo',
            ['EU05', 'APAC'],
            'development'
        );

        expect(findCartridgeFolders).toHaveBeenCalledWith('/mock/repo');
        expect(fetchSitesFromAllRealms).toHaveBeenCalledWith(['EU05', 'APAC']);
        expect(compareCartridges).toHaveBeenCalled();
        expect(exportComparisonToFile).toHaveBeenCalled();
        expect(result).toHaveProperty('realmSummary');
        expect(result).toHaveProperty('comparisonResult');
        expect(result).toHaveProperty('consolidatedFilePath');
    });

    it('returns undefined when no cartridges found', async () => {
        findCartridgeFolders.mockReturnValue([]);

        const result = await executeValidateCartridgesAll('/mock/repo', ['EU05']);

        expect(result).toBeUndefined();
        expect(fetchSitesFromAllRealms).not.toHaveBeenCalled();
    });

    it('returns undefined when no realms are available', async () => {
        getAvailableRealms.mockReturnValue([]);

        const result = await executeValidateCartridgesAll('/mock/repo', []);

        expect(result).toBeUndefined();
    });

    it('returns undefined when no sites found across realms', async () => {
        fetchSitesFromAllRealms.mockResolvedValue({
            allSites: [],
            realmSummary: []
        });

        const result = await executeValidateCartridgesAll('/mock/repo', ['EU05']);

        expect(result).toBeUndefined();
        expect(compareCartridges).not.toHaveBeenCalled();
    });

    it('uses getAvailableRealms when no realms provided', async () => {
        getAvailableRealms.mockReturnValue(['GB', 'PNA']);
        findCartridgeFolders.mockReturnValue(['app_storefront']);
        fetchSitesFromAllRealms.mockResolvedValue({
            allSites: [{ name: 'SiteA', cartridges: ['app_storefront'] }],
            realmSummary: [{ realm: 'GB', siteCount: 1 }]
        });

        await executeValidateCartridgesAll('/mock/repo', null);

        expect(fetchSitesFromAllRealms).toHaveBeenCalledWith(['GB', 'PNA']);
    });

    it('passes instanceTypeOverride to exportComparisonToFile', async () => {
        findCartridgeFolders.mockReturnValue(['app_storefront']);
        fetchSitesFromAllRealms.mockResolvedValue({
            allSites: [{ name: 'SiteA', cartridges: ['app_storefront'] }],
            realmSummary: [{ realm: 'EU05', siteCount: 1 }]
        });

        await executeValidateCartridgesAll('/mock/repo', ['EU05'], 'staging');

        expect(exportComparisonToFile).toHaveBeenCalledWith(
            expect.any(Object),
            'ALL_REALMS',
            'staging'
        );
    });
});

// ============================================================================
// executeValidateSiteXml
// ============================================================================

describe('executeValidateSiteXml', () => {
    it('returns null when siteTemplatesPath is not configured', async () => {
        getRealmConfig.mockReturnValue({});

        const result = await executeValidateSiteXml('/mock/repo', 'EU05');

        expect(result).toBeNull();
    });

    it('returns null when no site.xml files found', async () => {
        findSiteXmlFiles.mockResolvedValue([]);

        const result = await executeValidateSiteXml('/mock/repo', 'EU05');

        expect(result).toBeNull();
    });

    it('returns null when no live sites found', async () => {
        findSiteXmlFiles.mockResolvedValue([
            { siteLocale: 'default', relativePath: 'sites/site.xml' }
        ]);
        fetchAndTransformSites.mockResolvedValue(null);

        const result = await executeValidateSiteXml('/mock/repo', 'EU05');

        expect(result).toBeNull();
    });

    it('returns stats and report path on successful validation', async () => {
        getRealmConfig.mockReturnValue({ siteTemplatesPath: 'sites/site_template' });
        findSiteXmlFiles.mockResolvedValue([
            { siteLocale: 'default', relativePath: 'sites/site.xml' }
        ]);
        fetchAndTransformSites.mockResolvedValue([
            { id: 'SiteA', cartridges: ['app_storefront'] }
        ]);
        parseAndCompareSiteXmls.mockResolvedValue([
            { file: 'site.xml', matches: true }
        ]);
        exportSiteXmlComparison.mockResolvedValue('/mock/report.txt');
        calculateValidationStats.mockReturnValue({
            totalFiles: 1,
            totalMatches: 1,
            totalMismatches: 0
        });

        const result = await executeValidateSiteXml('/mock/repo', 'EU05');

        expect(result).toHaveProperty('stats');
        expect(result).toHaveProperty('reportPath', '/mock/report.txt');
        expect(result).toHaveProperty('comparisons');
        expect(result.stats.totalFiles).toBe(1);
    });

    it('returns null when comparisons are empty', async () => {
        findSiteXmlFiles.mockResolvedValue([
            { siteLocale: 'default', relativePath: 'sites/site.xml' }
        ]);
        fetchAndTransformSites.mockResolvedValue([
            { id: 'SiteA', cartridges: ['app_storefront'] }
        ]);
        parseAndCompareSiteXmls.mockResolvedValue([]);

        const result = await executeValidateSiteXml('/mock/repo', 'EU05');

        expect(result).toBeNull();
    });

    it('returns null when fetchAndTransformSites returns empty array', async () => {
        findSiteXmlFiles.mockResolvedValue([
            { siteLocale: 'default', relativePath: 'sites/site.xml' }
        ]);
        fetchAndTransformSites.mockResolvedValue([]);

        const result = await executeValidateSiteXml('/mock/repo', 'EU05');

        expect(result).toBeNull();
    });
});
