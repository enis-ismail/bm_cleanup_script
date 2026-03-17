import {
    checkAllRealmEndpoints,
    checkRealmEndpoints,
    buildHealthReport
} from '../helpers/endpointHealthCheck.js';

// ============================================================================
// CHECK API ENDPOINTS
// Probe all OCAPI endpoints for configured realms and report status
// ============================================================================

/**
 * Check OCAPI endpoint accessibility for all configured realms.
 * @param {Object} options - Command options
 * @param {string} [options.realm] - Check a single realm instead of all
 */
export async function checkApiEndpoints(options) {
    console.log('\nChecking OCAPI endpoint accessibility...\n');

    let results;
    if (options.realm) {
        console.log(`Checking realm: ${options.realm}\n`);
        results = [await checkRealmEndpoints(options.realm)];
    } else {
        results = await checkAllRealmEndpoints();
    }

    if (results.length === 0) {
        console.log('No realms configured in config.json. Run add-realm first.');
        return;
    }

    const { report, actionItems } = buildHealthReport(results);
    console.log(report);

    if (actionItems.length > 0) {
        console.log(
            'Tip: Copy the resource configuration from src/config/ocapi_config.json'
            + ' into your BM OCAPI Data API settings for each failing endpoint.\n'
            + ' make sure these are added for the correct credentials in the realm.\n'
        );
    }
}
