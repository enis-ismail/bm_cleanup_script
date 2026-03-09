import axios from 'axios';
import chalk from 'chalk';
import { getSandboxConfig, getAvailableRealms } from '../../../config/helpers/helpers.js';
import { getOAuthToken } from '../../../api/api.js';
import { LOG_PREFIX, SEPARATOR } from '../../../config/constants.js';

// ============================================================================
// ENDPOINT HEALTH CHECK
// Probe OCAPI endpoints for all configured realms and report status
// ============================================================================

/**
 * Status constants for endpoint check results
 */
const STATUS = Object.freeze({
    OK: 'OK',
    FORBIDDEN: 'FORBIDDEN',
    AUTH_FAILED: 'AUTH_FAILED',
    NOT_FOUND: 'NOT_FOUND',
    ERROR: 'ERROR'
});

const PROBE_TIMEOUT_MS = 15000;
const PERMISSION_GRANTED_MSG = 'Endpoint is accessible (permission granted)';

/**
 * Generate probe descriptors for multiple HTTP methods against the same resource.
 * Name is auto-generated as "{label} ({method})" and bmHint as
 * "Add {method} permission for {resourceId}."
 * @param {Object} resource - Base resource configuration
 * @param {string} resource.url - Endpoint URL
 * @param {string} resource.resourceId - OCAPI resource pattern
 * @param {string} resource.label - Human-readable resource label
 * @param {Array<Object>} methods - Method-specific configurations
 * @returns {Array<Object>} Probe descriptors
 * @private
 */
function generateMethodProbes({ url, resourceId, label }, methods) {
    return methods.map(({ method, body, acceptCodes }) => {
        const probe = {
            name: `${label} (${method})`,
            method,
            url,
            resourceId,
            bmHint: `Add ${method} permission for ${resourceId}.`
        };
        if (body !== undefined) { probe.body = body; }
        if (acceptCodes) { probe.acceptCodes = acceptCodes; }
        return probe;
    });
}

/**
 * Build the list of OCAPI endpoint probes to run against a realm.
 * Covers every resource and method from ocapi_config.json. Each probe
 * returns a descriptor with name, method, URL, and BM configuration hint.
 *
 * Write-method probes (PUT, PATCH, DELETE, POST) target nonexistent resources
 * so they cannot modify data. A non-403 response proves the permission is
 * granted. POST on job executions is skipped because it would start a job.
 *
 * @param {Object} sandbox - Realm config (hostname, instanceType, etc.)
 * @returns {Array<Object>} Endpoint probe descriptors
 * @private
 */
function buildEndpointProbes(sandbox) {
    const host = sandbox.hostname;
    const v1 = `https://${host}/s/-/dw/data/v19_5`;
    const v2 = `https://${host}/s/-/dw/data/v25_6`;
    const instanceType = sandbox.instanceType || 'development';

    const obj = 'SitePreferences';
    const hcAttr = 'c_nonexistent_health_check';
    const hcGroup = 'StorefrontConfigs';
    const hcSite = 'nonexistent_health_check_site';
    const hcJob = 'site%20preferences%20-%20BACKUP';

    const attrDefBase = `system_object_definitions/${obj}/attribute_definitions`;
    const attrGrpBase = `system_object_definitions/${obj}/attribute_groups`;

    return [
        // ── /sites (GET) ────────────────────────────────────────────────
        {
            name: 'Sites (list, GET)',
            method: 'GET',
            url: `${v1}/sites`,
            resourceId: '/sites',
            bmHint: 'Add resource /sites with GET permission in BM'
                + ' -> Administration -> Site Development'
                + ' -> Open Commerce API Settings -> Data API.'
        },

        // ── /sites/* (GET) ──────────────────────────────────────────────
        {
            name: 'Site (single, GET)',
            method: 'GET',
            url: `${v1}/sites/${hcSite}`,
            resourceId: '/sites/*',
            bmHint: 'Add resource /sites/* with GET permission.',
            acceptCodes: [404]
        },

        // ── /system_object_definitions/* (GET) ──────────────────────────
        {
            name: 'Object Type Definition (GET)',
            method: 'GET',
            url: `${v1}/system_object_definitions/${obj}`,
            resourceId: '/system_object_definitions/*',
            bmHint: 'Add resource /system_object_definitions/*'
                + ' with GET permission.'
        },

        // ── /system_object_definitions/*/attribute_definitions (GET) ────
        {
            name: 'Attribute Definitions (list, GET)',
            method: 'GET',
            url: `${v1}/${attrDefBase}?count=1`,
            resourceId: '/system_object_definitions/*/attribute_definitions',
            bmHint: 'Add resource'
                + ' /system_object_definitions/*/attribute_definitions'
                + ' with GET permission.'
        },

        // Attribute Definition — all methods against a nonexistent ID
        ...generateMethodProbes(
            {
                url: `${v2}/${attrDefBase}/${hcAttr}`,
                resourceId: '/system_object_definitions/*/attribute_definitions/*',
                label: 'Attribute Definition'
            },
            [
                { method: 'GET', acceptCodes: [404] },
                { method: 'PUT', body: {}, acceptCodes: [400, 404] },
                { method: 'POST', body: {}, acceptCodes: [400, 404, 405] },
                { method: 'PATCH', body: {}, acceptCodes: [400, 404] },
                { method: 'DELETE', acceptCodes: [404] }
            ]
        ),

        // ── /system_object_definitions/*/attribute_groups (GET) ─────────
        {
            name: 'Attribute Groups (list, GET)',
            method: 'GET',
            url: `${v2}/${attrGrpBase}?count=1`,
            resourceId: '/system_object_definitions/*/attribute_groups',
            bmHint: 'Add resource'
                + ' /system_object_definitions/*/attribute_groups'
                + ' with GET permission.'
        },

        // Attribute Group — GET and PUT against a known group
        ...generateMethodProbes(
            {
                url: `${v2}/${attrGrpBase}/${hcGroup}`,
                resourceId: '/system_object_definitions/*/attribute_groups/*',
                label: 'Attribute Group'
            },
            [
                { method: 'GET', acceptCodes: [404] },
                { method: 'PUT', body: {}, acceptCodes: [400, 404] }
            ]
        ),

        // Group Attr Assignment — all methods against a nonexistent assignment
        ...generateMethodProbes(
            {
                url: `${v2}/${attrGrpBase}/${hcGroup}/attribute_definitions/${hcAttr}`,
                resourceId: '/.../attribute_groups/*/attribute_definitions/*',
                label: 'Group Attr Assignment'
            },
            [
                { method: 'GET', acceptCodes: [404, 405] },
                { method: 'PUT', body: {}, acceptCodes: [400, 404] },
                { method: 'POST', body: {}, acceptCodes: [400, 404, 405] },
                { method: 'DELETE', acceptCodes: [404] }
            ]
        ),

        // Site Preference Values — GET and PATCH
        ...generateMethodProbes(
            {
                url: `${v2}/sites/-/site_preferences/preference_groups/${hcGroup}/${instanceType}`,
                resourceId: '/sites/*/site_preferences/preference_groups/*/*',
                label: 'Site Preference Values'
            },
            [
                { method: 'GET', acceptCodes: [404] },
                { method: 'PATCH', body: {}, acceptCodes: [400, 404] }
            ]
        ),

        // ── /site_preferences/preference_groups/*/*/preference_search ───
        {
            name: 'Preference Search (POST)',
            method: 'POST',
            url: `${v2}/site_preferences`
                + `/preference_groups/${hcGroup}/${instanceType}`
                + '/preference_search',
            resourceId: '/.../preference_groups/*/*/preference_search',
            bmHint: 'Add POST permission for'
                + ' /site_preferences/preference_groups/*/*'
                + '/preference_search.',
            body: {},
            acceptCodes: [400, 404]
        },

        // ── /jobs/*/executions (GET only — POST skipped to avoid
        //    triggering job execution) ───────────────────────────────────
        {
            name: 'Job Executions (GET)',
            method: 'GET',
            url: `${v1}/jobs/${hcJob}/executions?count=1`,
            resourceId: '/jobs/*/executions',
            bmHint: 'Add resource /jobs/*/executions with POST, GET'
                + ' permissions. Also verify the backup job exists in'
                + ' BM -> Administration -> Operations -> Jobs.',
            acceptCodes: [404]
        },

        // ── /jobs/*/executions/* (GET) ──────────────────────────────────
        {
            name: 'Job Execution (single, GET)',
            method: 'GET',
            url: `${v1}/jobs/${hcJob}/executions/nonexistent_hc`,
            resourceId: '/jobs/*/executions/*',
            bmHint: 'Add resource /jobs/*/executions/*'
                + ' with GET permission.',
            acceptCodes: [404]
        }
    ];
}

/**
 * Classify an HTTP error into a status category.
 * @param {Error} error - Axios error
 * @returns {{ status: string, httpStatus: number|null, message: string }}
 * @private
 */
function classifyError(error) {
    const httpStatus = error.response?.status || null;
    const serverMessage = error.response?.data?.fault?.message
        || error.response?.data?.message
        || error.message;

    if (httpStatus === 403) {
        return { status: STATUS.FORBIDDEN, httpStatus, message: serverMessage };
    }
    if (httpStatus === 401) {
        return { status: STATUS.AUTH_FAILED, httpStatus, message: serverMessage };
    }
    if (httpStatus === 404) {
        return { status: STATUS.NOT_FOUND, httpStatus, message: serverMessage };
    }
    return { status: STATUS.ERROR, httpStatus, message: serverMessage };
}

/**
 * Probe a single OCAPI endpoint and return the result.
 * For write-method probes on nonexistent resources, acceptable HTTP status
 * codes (400, 404, 405) prove the permission is granted without modifying data.
 * @param {Object} probe - Endpoint probe descriptor
 * @param {string} token - OAuth bearer token
 * @returns {Promise<Object>} Probe result with status, httpStatus, message
 * @private
 */
async function probeEndpoint(probe, token) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const config = {
        method: probe.method,
        url: probe.url,
        headers,
        timeout: PROBE_TIMEOUT_MS
    };

    if (probe.body !== undefined) {
        config.data = probe.body;
    }

    try {
        const response = await axios(config);
        return {
            name: probe.name,
            resourceId: probe.resourceId,
            status: STATUS.OK,
            httpStatus: response.status,
            message: null
        };
    } catch (error) {
        const classified = classifyError(error);
        const acceptCodes = probe.acceptCodes || [];

        if (acceptCodes.includes(classified.httpStatus)) {
            return {
                name: probe.name,
                resourceId: probe.resourceId,
                status: STATUS.OK,
                httpStatus: classified.httpStatus,
                message: PERMISSION_GRANTED_MSG
            };
        }

        return {
            name: probe.name,
            resourceId: probe.resourceId,
            bmHint: probe.bmHint,
            ...classified
        };
    }
}

/**
 * Check all OCAPI endpoints for a single realm.
 * @param {string} realmName - Realm name from config.json
 * @returns {Promise<Object>} Realm health check result
 */
export async function checkRealmEndpoints(realmName) {
    const result = {
        realm: realmName,
        hostname: null,
        authStatus: null,
        authMessage: null,
        endpoints: []
    };

    // Step 1: Load realm config â€” catch missing/invalid config
    let sandbox;
    try {
        sandbox = getSandboxConfig(realmName);
        result.hostname = sandbox.hostname;
    } catch (configError) {
        result.authStatus = STATUS.ERROR;
        result.authMessage = `Config error: ${configError.message}`;
        return result;
    }

    // Step 2: Validate credentials are present
    if (!sandbox.clientId || !sandbox.clientSecret) {
        result.authStatus = STATUS.AUTH_FAILED;
        result.authMessage = 'clientId or clientSecret is missing in config.json for this realm.';
        return result;
    }

    // Step 3: Attempt OAuth token
    let token;
    try {
        token = await getOAuthToken(sandbox);
        result.authStatus = STATUS.OK;
    } catch (authError) {
        const httpStatus = authError.response?.status || null;
        if (httpStatus === 401 || httpStatus === 403) {
            result.authStatus = STATUS.AUTH_FAILED;
            result.authMessage = `OAuth failed (HTTP ${httpStatus}). Verify clientId and clientSecret in config.json.`;
        } else {
            result.authStatus = STATUS.ERROR;
            result.authMessage = `OAuth error: ${authError.message}`;
        }
        return result;
    }

    // Step 4: Probe each endpoint
    const probes = buildEndpointProbes(sandbox);
    for (const probe of probes) {
        const probeResult = await probeEndpoint(probe, token);
        result.endpoints.push(probeResult);
    }

    return result;
}

/**
 * Run endpoint health checks across all configured realms in parallel.
 * Each realm targets a separate server so requests can safely run concurrently.
 * @returns {Promise<Array<Object>>} Array of per-realm health check results
 */
export async function checkAllRealmEndpoints() {
    const realms = getAvailableRealms();
    if (realms.length === 0) {
        return [];
    }

    return Promise.all(realms.map(realm => checkRealmEndpoints(realm)));
}

/**
 * Format a single realm result into human-readable console lines.
 * @param {Object} realmResult - Output from checkRealmEndpoints
 * @returns {string[]} Array of formatted lines
 * @private
 */
function formatRealmResult(realmResult) {
    const lines = [];
    const { realm, hostname, authStatus, authMessage, endpoints } = realmResult;

    lines.push(SEPARATOR);
    lines.push(`Realm: ${chalk.bold(realm)}  (${hostname || 'unknown host'})`);
    lines.push(SEPARATOR);

    // Auth status
    if (authStatus !== STATUS.OK) {
        const label = authStatus === STATUS.AUTH_FAILED ? 'FAILED' : 'ERROR';
        lines.push(`  ${chalk.red(LOG_PREFIX.ERROR)} Authentication: ${chalk.red(label)}`);
        lines.push(chalk.red(`    -> ${authMessage}`));
        lines.push('');
        return lines;
    }
    lines.push(`  ${chalk.green(LOG_PREFIX.INFO)} Authentication: ${chalk.green('OK')}`);

    // Endpoint results
    if (endpoints.length === 0) {
        lines.push('  No endpoints were checked.');
        lines.push('');
        return lines;
    }

    const passing = endpoints.filter(e => e.status === STATUS.OK);
    const countColor = passing.length === endpoints.length ? chalk.green : chalk.yellow;

    lines.push(`  Endpoints: ${countColor(`${passing.length}/${endpoints.length}`)} accessible`);
    lines.push('');

    for (const ep of endpoints) {
        if (ep.status === STATUS.OK) {
            const extra = ep.message ? chalk.dim(` - ${ep.message}`) : '';
            lines.push(`  ${chalk.green(LOG_PREFIX.INFO)} ${chalk.green(ep.name)} (${ep.resourceId})${extra}`);
        } else if (ep.status === STATUS.FORBIDDEN) {
            lines.push(`  ${chalk.red(LOG_PREFIX.ERROR)} ${chalk.red(ep.name)} (${ep.resourceId}) - ${chalk.red('403 Forbidden')}`);
            lines.push(chalk.red(`    -> ${ep.bmHint}`));
        } else {
            const code = ep.httpStatus ? `HTTP ${ep.httpStatus}` : 'network error';
            lines.push(`  ${chalk.yellow(LOG_PREFIX.WARNING)} ${chalk.yellow(ep.name)}`
                + ` (${ep.resourceId}) - ${chalk.yellow(code)}`);
            lines.push(chalk.yellow(`    -> ${ep.message}`));
            if (ep.bmHint) {
                lines.push(chalk.yellow(`    -> ${ep.bmHint}`));
            }
        }
    }

    lines.push('');
    return lines;
}

/**
 * Build the full diagnostic report for all realm results.
 * @param {Array<Object>} results - Array from checkAllRealmEndpoints
 * @returns {{ report: string, actionItems: string[] }}
 */
export function buildHealthReport(results) {
    const lines = [];
    const actionItems = [];

    lines.push('');
    lines.push('OCAPI Endpoint Health Check');
    lines.push(`Date: ${new Date().toISOString()}`);
    lines.push(`Realms checked: ${results.length}`);
    lines.push('');

    for (const realmResult of results) {
        lines.push(...formatRealmResult(realmResult));

        // Collect action items
        if (realmResult.authStatus === STATUS.AUTH_FAILED) {
            actionItems.push(
                `[${realmResult.realm}] Fix authentication: ${realmResult.authMessage}`
            );
        }

        for (const ep of realmResult.endpoints) {
            if (ep.status === STATUS.FORBIDDEN) {
                actionItems.push(
                    `[${realmResult.realm}] ${ep.name}: ${ep.bmHint}`
                );
            } else if (ep.status === STATUS.ERROR) {
                actionItems.push(
                    `[${realmResult.realm}] ${ep.name}: ${ep.message}`
                );
            }
        }
    }

    // Summary
    const totalEndpoints = results.reduce((sum, r) => sum + r.endpoints.length, 0);
    const totalPassing = results.reduce(
        (sum, r) => sum + r.endpoints.filter(e => e.status === STATUS.OK).length, 0
    );
    const authOk = results.filter(r => r.authStatus === STATUS.OK).length;

    lines.push(SEPARATOR);
    lines.push(chalk.bold('Summary'));
    lines.push(SEPARATOR);
    const authRatio = `${authOk}/${results.length}`;
    const authColor = authOk === results.length ? chalk.green(authRatio) : chalk.red(authRatio);
    lines.push(`  Realms authenticated:  ${authColor}`);

    const epRatio = `${totalPassing}/${totalEndpoints}`;
    const epColor = totalPassing === totalEndpoints ? chalk.green(epRatio) : chalk.yellow(epRatio);
    lines.push(`  Endpoints accessible:  ${epColor}`);

    if (actionItems.length > 0) {
        lines.push('');
        lines.push(chalk.red('Action Items:'));
        actionItems.forEach((item, i) => {
            lines.push(chalk.red(`  ${i + 1}. ${item}`));
        });
    } else {
        lines.push('');
        lines.push(`  ${chalk.green(LOG_PREFIX.INFO)} ${chalk.green('All endpoints are properly configured.')}`);
    }

    lines.push('');

    return { report: lines.join('\n'), actionItems };
}
