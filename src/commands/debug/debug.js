import { listAttributeGroups, getAttributeGroup } from './actions/attributeGroupActions.js';
import {
    testPatchAttribute,
    testPutAttribute,
    testDeleteAttribute,
    testSetSitePreference
} from './actions/attributeTestActions.js';
import { testActivePreferences, findPreferenceUsageCommand } from './actions/preferenceDiscovery.js';
import { testBackupRestoreCycle } from './actions/backupRestoreCycle.js';
import { findAttributeGroupInMeta } from './actions/findAttributeGroupInMeta.js';
import { testGenerateBackupJson } from './actions/testGenerateBackupJson.js';
import { testConcurrentTimers, debugProgress } from './actions/progressTests.js';
import { checkApiEndpoints } from './actions/checkApiEndpoints.js';

// ============================================================================
// DEBUG COMMANDS REGISTRATION
// Register all debug/test commands with the CLI program
// ============================================================================

/**
 * Register debug commands with the CLI program.
 * @param {import('commander').Command} program - Commander.js program instance
 */
export function registerDebugCommands(program) {
    program
        .command('list-attribute-groups')
        .description('(Debug) List attribute groups for an object type')
        .option('-v, --verbose', 'Show full JSON for first group')
        .action(async (options) => listAttributeGroups(options));

    program
        .command('get-attribute-group')
        .description('(Debug) Get full details of a specific attribute group')
        .action(getAttributeGroup);

    program
        .command('test-active-preferences')
        .description('(Debug) Display all active preferences from matrix files')
        .action(testActivePreferences);

    program
        .command('find-preference-usage')
        .description('(Debug) Find cartridges using a specific preference ID')
        .action(findPreferenceUsageCommand);

    program
        .command('test-patch-attribute')
        .description('(Debug) Test patching an attribute definition with partial update')
        .action(testPatchAttribute);

    program
        .command('test-put-attribute')
        .description('(Debug) Test replacing an attribute definition with full update')
        .action(testPutAttribute);

    program
        .command('test-delete-attribute')
        .description('(Debug) Test deleting an attribute definition')
        .action(testDeleteAttribute);

    program
        .command('test-set-site-preference')
        .description('(Debug) Test setting a site preference value for a specific site')
        .action(testSetSitePreference);

    program
        .command('test-backup-restore-cycle')
        .description('(Debug) Test full backup → delete → restore cycle for an attribute')
        .action(testBackupRestoreCycle);

    program
        .command('find-attribute-group-in-meta')
        .description('(Debug) Search for attribute group in sibling repository meta.xml files')
        .action(findAttributeGroupInMeta);

    program
        .command('test-generate-backup-json')
        .description('[TEST] Generate SitePreferences backup JSON from unused preferences list and usage CSV')
        .action(testGenerateBackupJson);

    program
        .command('test-concurrent-timers')
        .description('(Debug) Test dynamic parent/child progress logging')
        .action(testConcurrentTimers);

    program
        .command('debug-progress')
        .description('(Debug) Simulate analyze-preferences progress display with console interference')
        .action(debugProgress);

    program
        .command('check-api-endpoints')
        .description('Check OCAPI endpoint accessibility for all configured realms')
        .option('-r, --realm <realm>', 'Check a single realm instead of all')
        .action(async (options) => checkApiEndpoints(options));
}

