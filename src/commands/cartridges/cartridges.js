import { listSites, executeListSites } from './actions/listSites.js';
import { validateCartridgesAll, executeValidateCartridgesAll } from './actions/validateCartridgesAll.js';
import { validateSiteXml, executeValidateSiteXml } from './actions/validateSiteXml.js';

// Re-export execute functions for external consumers (tests, other commands)
export { executeListSites, executeValidateCartridgesAll, executeValidateSiteXml };

// ============================================================================
// CARTRIDGE COMMANDS REGISTRATION
// Register all cartridge-related commands with the CLI program
// ============================================================================

/**
 * Register cartridge commands with the CLI
 * @param {import('commander').Command} program - Commander program instance
 */
export function registerCartridgeCommands(program) {
    program
        .command('list-sites')
        .description('List all sites and export cartridge paths to CSV')
        .action(listSites);

    program
        .command('validate-cartridges-all')
        .description('[WIP] Validate cartridges across ALL configured realms (parallel)')
        .action(validateCartridgesAll);

    program
        .command('validate-site-xml')
        .description('[WIP] Validate that site.xml files match live SFCC cartridge paths')
        .action(validateSiteXml);
}
