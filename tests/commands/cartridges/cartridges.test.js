import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { Command } from 'commander';

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

vi.mock('inquirer', () => ({
    default: { prompt: vi.fn() }
}));

import {
    registerCartridgeCommands,
    executeListSites,
    executeValidateCartridgesAll,
    executeValidateSiteXml
} from '../../../src/commands/cartridges/cartridges.js';
import inquirer from 'inquirer';
import { exportSitesCartridgesToCSV } from '../../../src/io/csv.js';
import { findCartridgeFolders, calculateValidationStats, getSiblingRepositories } from '../../../src/io/util.js';
import { compareCartridges, exportComparisonToFile } from '../../../src/commands/cartridges/helpers/cartridgeComparison.js';
import { fetchAndTransformSites, fetchSitesFromAllRealms } from '../../../src/commands/cartridges/helpers/siteHelper.js';
import { getAvailableRealms, getRealmConfig } from '../../../src/index.js';
import { findSiteXmlFiles, parseAndCompareSiteXmls, exportSiteXmlComparison } from '../../../src/io/siteXmlHelper.js';
import { resolveRealmScopeSelection } from '../../../src/commands/prompts/commonPrompts.js';
import {
    logCartridgeValidationSummaryHeader,
    logRealmsProcessed,
    logCartridgeValidationStats,
    logCartridgeValidationWarning,
    logCartridgeValidationSummaryFooter,
    logSiteXmlValidationSummary
} from '../../../src/scripts/loggingScript/log.js';

// Helper to trigger commands
async function triggerCommand(commandName) {
    const program = new Command();
    program.exitOverride();
    registerCartridgeCommands(program);
    await program.parseAsync(['node', 'test', commandName]);
}

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

// ============================================================================
// listSites — command flow
// ============================================================================

describe('listSites command flow', () => {
    it('calls resolveRealmScopeSelection and processes each realm', async () => {
        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05', 'APAC'],
            instanceTypeOverride: null
        });

        await triggerCommand('list-sites');

        expect(resolveRealmScopeSelection).toHaveBeenCalled();
        expect(exportSitesCartridgesToCSV).toHaveBeenCalledWith('EU05');
        expect(exportSitesCartridgesToCSV).toHaveBeenCalledWith('APAC');
        expect(exportSitesCartridgesToCSV).toHaveBeenCalledTimes(2);
    });

    it('exits early when no realms selected', async () => {
        resolveRealmScopeSelection.mockResolvedValue({
            realmList: [],
            instanceTypeOverride: null
        });

        await triggerCommand('list-sites');

        expect(exportSitesCartridgesToCSV).not.toHaveBeenCalled();
    });

    it('exits early when realmList is null', async () => {
        resolveRealmScopeSelection.mockResolvedValue({
            realmList: null,
            instanceTypeOverride: null
        });

        await triggerCommand('list-sites');

        expect(exportSitesCartridgesToCSV).not.toHaveBeenCalled();
    });
});

// ============================================================================
// validateCartridgesAll — command flow
// ============================================================================

describe('validateCartridgesAll command flow', () => {
    it('calls logging functions with validation results', async () => {
        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'],
            instanceTypeOverride: 'development'
        });
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt.mockResolvedValueOnce({ repository: 'repo-a' });

        await triggerCommand('validate-cartridges-all');

        expect(logCartridgeValidationSummaryHeader).toHaveBeenCalled();
        expect(logRealmsProcessed).toHaveBeenCalled();
        expect(logCartridgeValidationStats).toHaveBeenCalled();
        expect(logCartridgeValidationSummaryFooter).toHaveBeenCalled();
    });

    it('shows warning when unused cartridges exist', async () => {
        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'],
            instanceTypeOverride: 'development'
        });
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt.mockResolvedValueOnce({ repository: 'repo-a' });

        compareCartridges.mockReturnValue({
            total: 2,
            used: ['app_storefront'],
            unused: ['int_payment'],
            detail: []
        });

        await triggerCommand('validate-cartridges-all');

        expect(logCartridgeValidationWarning).toHaveBeenCalledWith(
            1,
            expect.any(String)
        );
    });

    it('exits early when no realms selected', async () => {
        resolveRealmScopeSelection.mockResolvedValue({
            realmList: [],
            instanceTypeOverride: null
        });

        await triggerCommand('validate-cartridges-all');

        expect(logCartridgeValidationSummaryHeader).not.toHaveBeenCalled();
    });

    it('exits early when no sibling repositories found', async () => {
        resolveRealmScopeSelection.mockResolvedValue({
            realmList: ['EU05'],
            instanceTypeOverride: null
        });
        getSiblingRepositories.mockResolvedValue([]);

        await triggerCommand('validate-cartridges-all');

        expect(findCartridgeFolders).not.toHaveBeenCalled();
    });
});

// ============================================================================
// validateSiteXml — command flow
// ============================================================================

describe('validateSiteXml command flow', () => {
    it('calls logSiteXmlValidationSummary with results', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ realm: 'EU05' });

        getRealmConfig.mockReturnValue({ siteTemplatesPath: 'sites/template' });
        findSiteXmlFiles.mockResolvedValue([
            { siteLocale: 'default', relativePath: 'sites/site.xml' }
        ]);
        fetchAndTransformSites.mockResolvedValue([
            { id: 'SiteA', cartridges: ['app_storefront'] }
        ]);
        parseAndCompareSiteXmls.mockResolvedValue([{ file: 'site.xml', matches: true }]);

        await triggerCommand('validate-site-xml');

        expect(logSiteXmlValidationSummary).toHaveBeenCalled();
    });

    it('exits early when no sibling repos found', async () => {
        getSiblingRepositories.mockResolvedValue([]);

        await triggerCommand('validate-site-xml');

        expect(findSiteXmlFiles).not.toHaveBeenCalled();
    });

    it('does not call logSiteXmlValidationSummary when validation returns null', async () => {
        getSiblingRepositories.mockResolvedValue(['repo-a']);
        inquirer.prompt
            .mockResolvedValueOnce({ repository: 'repo-a' })
            .mockResolvedValueOnce({ realm: 'EU05' });

        getRealmConfig.mockReturnValue({});

        await triggerCommand('validate-site-xml');

        expect(logSiteXmlValidationSummary).not.toHaveBeenCalled();
    });
});
