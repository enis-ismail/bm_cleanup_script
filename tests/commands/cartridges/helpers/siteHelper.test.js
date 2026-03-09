import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../../src/api/api.js', () => ({
    getAllSites: vi.fn(),
    getSiteById: vi.fn()
}));

vi.mock('../../../../src/io/util.js', () => ({
    transformSiteToCartridgeInfo: vi.fn()
}));

vi.mock('../../../../src/config/constants.js', () => ({
    LOG_PREFIX: {
        WARNING: '[WARN]',
        INFO: '[INFO]',
        ERROR: '[ERROR]'
    }
}));

import {
    fetchAndTransformSites,
    fetchSitesFromAllRealms
} from '../../../../src/commands/cartridges/helpers/siteHelper.js';
import { getAllSites, getSiteById } from '../../../../src/api/api.js';
import { transformSiteToCartridgeInfo } from '../../../../src/io/util.js';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// fetchAndTransformSites
// ============================================================================

describe('fetchAndTransformSites', () => {
    it('returns transformed sites for a valid realm', async () => {
        getAllSites.mockResolvedValue([
            { id: 'site1' },
            { id: 'site2' }
        ]);
        getSiteById.mockResolvedValueOnce({ id: 'site1', name: 'Site One' });
        getSiteById.mockResolvedValueOnce({ id: 'site2', name: 'Site Two' });
        transformSiteToCartridgeInfo.mockImplementation((site, realm) => ({
            name: site.name,
            realm,
            cartridges: ['app_storefront']
        }));

        const result = await fetchAndTransformSites('EU05');

        expect(getAllSites).toHaveBeenCalledWith('EU05');
        expect(getSiteById).toHaveBeenCalledTimes(2);
        expect(transformSiteToCartridgeInfo).toHaveBeenCalledTimes(2);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('Site One');
    });

    it('returns null when no sites found', async () => {
        getAllSites.mockResolvedValue([]);

        const result = await fetchAndTransformSites('EU05');

        expect(result).toBeNull();
        expect(getSiteById).not.toHaveBeenCalled();
    });

    it('filters out null site details', async () => {
        getAllSites.mockResolvedValue([
            { id: 'site1' },
            { id: 'site2' }
        ]);
        getSiteById.mockResolvedValueOnce({ id: 'site1', name: 'Site One' });
        getSiteById.mockResolvedValueOnce(null); // site2 fails
        transformSiteToCartridgeInfo.mockImplementation((site) => ({
            name: site.name,
            cartridges: []
        }));

        const result = await fetchAndTransformSites('EU05');

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Site One');
    });

    it('uses site_id fallback when id is missing', async () => {
        getAllSites.mockResolvedValue([{ site_id: 'mySite' }]);
        getSiteById.mockResolvedValue({ id: 'mySite', name: 'My Site' });
        transformSiteToCartridgeInfo.mockReturnValue({ name: 'My Site', cartridges: [] });

        await fetchAndTransformSites('EU05');

        expect(getSiteById).toHaveBeenCalledWith('mySite', 'EU05');
    });

    it('uses siteId fallback when id and site_id are missing', async () => {
        getAllSites.mockResolvedValue([{ siteId: 'fallbackSite' }]);
        getSiteById.mockResolvedValue({ id: 'fallbackSite', name: 'Fallback' });
        transformSiteToCartridgeInfo.mockReturnValue({ name: 'Fallback', cartridges: [] });

        await fetchAndTransformSites('EU05');

        expect(getSiteById).toHaveBeenCalledWith('fallbackSite', 'EU05');
    });
});

// ============================================================================
// fetchSitesFromAllRealms
// ============================================================================

describe('fetchSitesFromAllRealms', () => {
    it('aggregates sites from multiple realms', async () => {
        getAllSites.mockImplementation(async (realm) => {
            if (realm === 'EU05') {
                return [{ id: 'eu_site' }];
            }
            if (realm === 'APAC') {
                return [{ id: 'apac_site' }];
            }
            return [];
        });
        getSiteById.mockImplementation(async (siteId) => ({
            id: siteId,
            name: siteId
        }));
        transformSiteToCartridgeInfo.mockImplementation((site, realm) => ({
            name: site.name,
            realm,
            cartridges: ['cart_a']
        }));

        const { allSites, realmSummary } = await fetchSitesFromAllRealms(['EU05', 'APAC']);

        expect(allSites).toHaveLength(2);
        expect(realmSummary).toHaveLength(2);
        expect(realmSummary[0]).toEqual({ realm: 'EU05', siteCount: 1 });
        expect(realmSummary[1]).toEqual({ realm: 'APAC', siteCount: 1 });
    });

    it('excludes realms with no sites from summary', async () => {
        getAllSites.mockImplementation(async (realm) => {
            if (realm === 'EU05') {
                return [{ id: 'eu_site' }];
            }
            return []; // APAC has no sites
        });
        getSiteById.mockResolvedValue({ id: 'eu_site', name: 'EU Site' });
        transformSiteToCartridgeInfo.mockReturnValue({
            name: 'EU Site',
            realm: 'EU05',
            cartridges: []
        });

        const { allSites, realmSummary } = await fetchSitesFromAllRealms(['EU05', 'APAC']);

        expect(allSites).toHaveLength(1);
        expect(realmSummary).toHaveLength(1);
        expect(realmSummary[0].realm).toBe('EU05');
    });

    it('handles realm fetch errors gracefully', async () => {
        getAllSites.mockImplementation(async (realm) => {
            if (realm === 'APAC') {
                throw new Error('Network error');
            }
            return [{ id: 'eu_site' }];
        });
        getSiteById.mockResolvedValue({ id: 'eu_site', name: 'EU Site' });
        transformSiteToCartridgeInfo.mockReturnValue({
            name: 'EU Site',
            realm: 'EU05',
            cartridges: []
        });

        const { allSites, realmSummary } = await fetchSitesFromAllRealms(['EU05', 'APAC']);

        expect(allSites).toHaveLength(1);
        expect(realmSummary).toHaveLength(1);
    });

    it('returns empty results when all realms fail', async () => {
        getAllSites.mockResolvedValue([]);

        const { allSites, realmSummary } = await fetchSitesFromAllRealms(['EU05', 'APAC']);

        expect(allSites).toEqual([]);
        expect(realmSummary).toEqual([]);
    });

    it('handles empty realms array', async () => {
        const { allSites, realmSummary } = await fetchSitesFromAllRealms([]);

        expect(allSites).toEqual([]);
        expect(realmSummary).toEqual([]);
    });
});
