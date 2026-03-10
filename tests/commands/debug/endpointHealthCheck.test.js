import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Module Mocks — declared BEFORE importing the module under test
// ============================================================================

vi.mock('../../../src/config/helpers/helpers.js', () => ({
    getSandboxConfig: vi.fn(),
    getAvailableRealms: vi.fn(() => []),
    getBackupConfig: vi.fn(() => ({
        jobId: 'site preferences - BACKUP',
        ocapiVersion: 'v25_6'
    }))
}));

vi.mock('../../../src/api/api.js', () => ({
    getOAuthToken: vi.fn()
}));

// Mock axios for endpoint probing
vi.mock('axios', () => ({
    default: vi.fn()
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import {
    checkRealmEndpoints,
    checkAllRealmEndpoints,
    buildHealthReport
} from '../../../src/commands/debug/helpers/endpointHealthCheck.js';
import { getSandboxConfig, getAvailableRealms } from '../../../src/config/helpers/helpers.js';
import { getOAuthToken } from '../../../src/api/api.js';
import axios from 'axios';

beforeEach(() => {
    vi.clearAllMocks();
});

// ============================================================================
// checkRealmEndpoints
// ============================================================================

const TOTAL_PROBES = 21;

describe('checkRealmEndpoints', () => {
    const mockSandbox = {
        name: 'EU05',
        hostname: 'eu05-001.dx.commercecloud.salesforce.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        instanceType: 'development'
    };

    it('returns error when realm config is missing', async () => {
        getSandboxConfig.mockImplementation(() => {
            throw new Error("Realm 'UNKNOWN' not found in config.json");
        });

        const result = await checkRealmEndpoints('UNKNOWN');

        expect(result.realm).toBe('UNKNOWN');
        expect(result.authStatus).toBe('ERROR');
        expect(result.authMessage).toContain('Config error');
        expect(result.endpoints).toEqual([]);
    });

    it('detects missing clientId/clientSecret', async () => {
        getSandboxConfig.mockReturnValue({
            ...mockSandbox,
            clientId: '',
            clientSecret: ''
        });

        const result = await checkRealmEndpoints('EU05');

        expect(result.authStatus).toBe('AUTH_FAILED');
        expect(result.authMessage).toContain('clientId or clientSecret is missing');
        expect(result.endpoints).toEqual([]);
    });

    it('detects OAuth authentication failure (403)', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockRejectedValue({
            response: { status: 403, data: { message: 'Forbidden' } }
        });

        const result = await checkRealmEndpoints('EU05');

        expect(result.authStatus).toBe('AUTH_FAILED');
        expect(result.authMessage).toContain('OAuth failed');
        expect(result.authMessage).toContain('403');
        expect(result.endpoints).toEqual([]);
    });

    it('detects OAuth network error', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await checkRealmEndpoints('EU05');

        expect(result.authStatus).toBe('ERROR');
        expect(result.authMessage).toContain('ECONNREFUSED');
    });

    it('probes all endpoints when auth succeeds', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');
        axios.mockResolvedValue({ status: 200, data: {} });

        const result = await checkRealmEndpoints('EU05');

        expect(result.authStatus).toBe('OK');
        expect(result.hostname).toBe(mockSandbox.hostname);
        expect(result.endpoints).toHaveLength(TOTAL_PROBES);
        // All endpoints should be OK when axios returns 200
        result.endpoints.forEach(ep => {
            expect(ep.status).toBe('OK');
        });
    });

    it('detects 403 Forbidden on specific endpoints', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');

        // First endpoint OK, second returns 403
        let callCount = 0;
        axios.mockImplementation(() => {
            callCount++;
            if (callCount === 2) {
                const error = new Error('Request failed with status code 403');
                error.response = {
                    status: 403,
                    data: { fault: { message: 'Access denied' } }
                };
                throw error;
            }
            return Promise.resolve({ status: 200, data: {} });
        });

        const result = await checkRealmEndpoints('EU05');

        expect(result.authStatus).toBe('OK');
        const forbidden = result.endpoints.filter(ep => ep.status === 'FORBIDDEN');
        expect(forbidden.length).toBe(1);
        expect(forbidden[0].bmHint).toBeTruthy();
    });

    it('treats expected 404 as OK for probes with acceptCodes', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');

        axios.mockImplementation(({ url }) => {
            // The single attribute definition probe uses a nonexistent ID — returns 404
            if (url.includes('c_nonexistent_health_check')) {
                const error = new Error('Not Found');
                error.response = { status: 404, data: { message: 'Not found' } };
                throw error;
            }
            return Promise.resolve({ status: 200, data: {} });
        });

        const result = await checkRealmEndpoints('EU05');

        const attrDefProbe = result.endpoints.find(
            ep => ep.name === 'Attribute Definition (GET)'
        );
        expect(attrDefProbe.status).toBe('OK');
        expect(attrDefProbe.httpStatus).toBe(404);
        expect(attrDefProbe.message).toContain('permission granted');
    });

    it('captures generic errors with HTTP status', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');

        axios.mockImplementation(() => {
            const error = new Error('Internal Server Error');
            error.response = { status: 500, data: { message: 'Server error' } };
            throw error;
        });

        const result = await checkRealmEndpoints('EU05');

        // 500 is not in any probe's acceptCodes, so all should be ERROR
        result.endpoints.forEach(ep => {
            expect(ep.status).toBe('ERROR');
            expect(ep.httpStatus).toBe(500);
        });
    });

    it('captures network errors without HTTP status', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');

        axios.mockImplementation(() => {
            throw new Error('ECONNREFUSED');
        });

        const result = await checkRealmEndpoints('EU05');

        result.endpoints.forEach(ep => {
            expect(ep.httpStatus).toBeNull();
            expect(ep.message).toContain('ECONNREFUSED');
        });
    });

    it('treats 400 as OK for write-method probes with acceptCodes', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');

        axios.mockImplementation(({ method }) => {
            if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
                const error = new Error('Bad Request');
                error.response = {
                    status: 400,
                    data: { fault: { message: 'Missing required field' } }
                };
                throw error;
            }
            return Promise.resolve({ status: 200, data: {} });
        });

        const result = await checkRealmEndpoints('EU05');

        const writeProbes = result.endpoints.filter(
            ep => ['PUT', 'PATCH', 'POST'].some(m => ep.name.includes(`(${m})`))
        );
        // All write probes should be OK since 400 is in their acceptCodes
        writeProbes.forEach(ep => {
            expect(ep.status).toBe('OK');
            expect(ep.httpStatus).toBe(400);
        });
    });

    it('sends request body for write-method probes', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');
        axios.mockResolvedValue({ status: 200, data: {} });

        await checkRealmEndpoints('EU05');

        // Find a PUT call — it should include data in the config
        const putCalls = axios.mock.calls.filter(
            ([config]) => config.method === 'PUT'
        );
        expect(putCalls.length).toBeGreaterThan(0);
        putCalls.forEach(([config]) => {
            expect(config.data).toEqual({});
        });

        // GET calls should not have data
        const getCalls = axios.mock.calls.filter(
            ([config]) => config.method === 'GET'
        );
        getCalls.forEach(([config]) => {
            expect(config.data).toBeUndefined();
        });
    });

    it('covers all ocapi_config.json resource patterns', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');
        axios.mockResolvedValue({ status: 200, data: {} });

        const result = await checkRealmEndpoints('EU05');

        const resourceIds = result.endpoints.map(ep => ep.resourceId);

        // Verify key resources from ocapi_config.json are all probed
        expect(resourceIds).toContain('/sites');
        expect(resourceIds).toContain('/sites/*');
        expect(resourceIds).toContain('/system_object_definitions/*');
        expect(resourceIds).toContain(
            '/system_object_definitions/*/attribute_definitions'
        );
        expect(resourceIds).toContain(
            '/system_object_definitions/*/attribute_definitions/*'
        );
        expect(resourceIds).toContain(
            '/system_object_definitions/*/attribute_groups'
        );
        expect(resourceIds).toContain(
            '/system_object_definitions/*/attribute_groups/*'
        );
        expect(resourceIds).toContain(
            '/.../attribute_groups/*/attribute_definitions/*'
        );
        expect(resourceIds).toContain(
            '/sites/*/site_preferences/preference_groups/*/*'
        );
        expect(resourceIds).toContain(
            '/.../preference_groups/*/*/preference_search'
        );
        expect(resourceIds).toContain('/jobs/*/executions');
        expect(resourceIds).toContain('/jobs/*/executions/*');
    });

    it('includes all required HTTP methods for attribute definitions', async () => {
        getSandboxConfig.mockReturnValue(mockSandbox);
        getOAuthToken.mockResolvedValue('mock-token');
        axios.mockResolvedValue({ status: 200, data: {} });

        await checkRealmEndpoints('EU05');

        const methods = axios.mock.calls
            .map(([config]) => config.method)
            .filter(Boolean);

        expect(methods).toContain('GET');
        expect(methods).toContain('PUT');
        expect(methods).toContain('POST');
        expect(methods).toContain('PATCH');
        expect(methods).toContain('DELETE');
    });
});

// ============================================================================
// checkAllRealmEndpoints
// ============================================================================

describe('checkAllRealmEndpoints', () => {
    it('returns empty array when no realms configured', async () => {
        getAvailableRealms.mockReturnValue([]);

        const results = await checkAllRealmEndpoints();

        expect(results).toEqual([]);
    });

    it('checks each configured realm', async () => {
        getAvailableRealms.mockReturnValue(['EU05', 'APAC']);
        getSandboxConfig.mockReturnValue({
            name: 'EU05',
            hostname: 'eu05.test.com',
            clientId: 'id',
            clientSecret: 'secret',
            instanceType: 'development'
        });
        getOAuthToken.mockResolvedValue('mock-token');
        axios.mockResolvedValue({ status: 200, data: {} });

        const results = await checkAllRealmEndpoints();

        expect(results).toHaveLength(2);
        expect(results[0].realm).toBe('EU05');
        expect(results[1].realm).toBe('APAC');
    });
});

// ============================================================================
// buildHealthReport
// ============================================================================

describe('buildHealthReport', () => {
    it('builds report with all OK endpoints', () => {
        const results = [{
            realm: 'EU05',
            hostname: 'eu05.test.com',
            authStatus: 'OK',
            authMessage: null,
            endpoints: [
                { name: 'List Sites', resourceId: '/sites', status: 'OK', httpStatus: 200, message: null },
                { name: 'Attr Defs', resourceId: '/sys/*/attr_defs', status: 'OK', httpStatus: 200, message: null }
            ]
        }];

        const { report, actionItems } = buildHealthReport(results);

        expect(report).toContain('OCAPI Endpoint Health Check');
        expect(report).toContain('EU05');
        expect(report).toContain('2/2 accessible');
        expect(report).toContain('All endpoints are properly configured');
        expect(actionItems).toHaveLength(0);
    });

    it('builds report with failed authentication', () => {
        const results = [{
            realm: 'GB',
            hostname: 'gb.test.com',
            clientId: 'gb-client-id',
            authStatus: 'AUTH_FAILED',
            authMessage: 'OAuth failed (HTTP 403). Verify clientId and clientSecret.',
            endpoints: []
        }];

        const { report, actionItems } = buildHealthReport(results);

        expect(report).toContain('Authentication: FAILED');
        expect(report).toContain('OAuth failed');
        expect(actionItems).toHaveLength(1);
        expect(actionItems[0]).toContain('[GB | clientId: gb-client-id]');
    });

    it('builds report with forbidden endpoints and action items', () => {
        const results = [{
            realm: 'APAC',
            hostname: 'apac.test.com',
            clientId: 'apac-client-id',
            authStatus: 'OK',
            authMessage: null,
            endpoints: [
                {
                    name: 'List Sites',
                    resourceId: '/sites',
                    status: 'OK',
                    httpStatus: 200,
                    message: null
                },
                {
                    name: 'Attr Groups',
                    resourceId: '/sys/*/attr_groups',
                    status: 'FORBIDDEN',
                    httpStatus: 403,
                    message: 'Access denied',
                    bmHint: 'Add GET permission for /system_object_definitions/*/attribute_groups'
                }
            ]
        }];

        const { report, actionItems } = buildHealthReport(results);

        expect(report).toContain('1/2 accessible');
        expect(report).toContain('403 Forbidden');
        expect(report).toContain('Action Items');
        expect(actionItems).toHaveLength(1);
        expect(actionItems[0]).toContain('Attr Groups');
        expect(actionItems[0]).toContain('Add GET permission');
        expect(actionItems[0]).toContain('[APAC | clientId: apac-client-id]');
    });

    it('builds summary across multiple realms', () => {
        const results = [
            {
                realm: 'EU05',
                hostname: 'eu05.test.com',
                authStatus: 'OK',
                authMessage: null,
                endpoints: [
                    { name: 'Sites', resourceId: '/sites', status: 'OK', httpStatus: 200, message: null }
                ]
            },
            {
                realm: 'APAC',
                hostname: 'apac.test.com',
                authStatus: 'AUTH_FAILED',
                authMessage: 'Missing credentials',
                endpoints: []
            }
        ];

        const { report, actionItems } = buildHealthReport(results);

        expect(report).toContain('Realms checked: 2');
        expect(report).toContain('Realms authenticated:  1/2');
        expect(report).toContain('Endpoints accessible:  1/1');
        expect(actionItems).toHaveLength(1);
    });

    it('collects error-status endpoints as action items', () => {
        const results = [{
            realm: 'PNA',
            hostname: 'pna.test.com',
            clientId: 'pna-client-id',
            authStatus: 'OK',
            authMessage: null,
            endpoints: [
                {
                    name: 'Job Executions',
                    resourceId: '/jobs/*/executions',
                    status: 'ERROR',
                    httpStatus: 500,
                    message: 'Server error'
                }
            ]
        }];

        const { actionItems } = buildHealthReport(results);

        expect(actionItems).toHaveLength(1);
        expect(actionItems[0]).toContain('[PNA | clientId: pna-client-id]');
        expect(actionItems[0]).toContain('Server error');
    });

    it('handles empty results array', () => {
        const { report, actionItems } = buildHealthReport([]);

        expect(report).toContain('Realms checked: 0');
        expect(report).toContain('All endpoints are properly configured');
        expect(actionItems).toHaveLength(0);
    });

    it('shows endpoint with extra message for OK status', () => {
        const results = [{
            realm: 'EU05',
            hostname: 'eu05.test.com',
            authStatus: 'OK',
            authMessage: null,
            endpoints: [
                {
                    name: 'Attribute Definition (GET)',
                    resourceId: '/system_object_definitions/*/attribute_definitions/*',
                    status: 'OK',
                    httpStatus: 404,
                    message: 'Endpoint is accessible (permission granted)'
                }
            ]
        }];

        const { report } = buildHealthReport(results);

        expect(report).toContain('permission granted');
        expect(report).toContain('1/1 accessible');
    });
});
