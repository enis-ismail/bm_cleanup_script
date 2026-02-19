import { Command } from 'commander';
import { registerDebugCommands } from './commands/debug/debug.js';
import { registerPreferenceCommands } from './commands/preferences/preferences.js';
import { registerCartridgeCommands } from './commands/cartridges/cartridges.js';
import { registerSetupCommands } from './commands/setup/setup.js';

// ============================================================================
// CLI ENTRYPOINT
// Central command registry for OCAPI tooling
// ============================================================================

const program = new Command();

// Command to list sites and export cartridge paths
program
    .name('OCAPI Tools')
    .description('Tools for working with SFCC OCAPI')
    .version('1.0.0');

// ============================================================================
// REGISTER SETUP COMMANDS
// ============================================================================
// Location: src/commands/setup/setup.js
// Commands:
//   - add-realm: Add a new realm to config.json
//   - remove-realm: Remove a realm from config.json

registerSetupCommands(program);

// ============================================================================
// REGISTER CARTRIDGE COMMANDS
// ============================================================================
// Location: src/commands/cartridges/cartridges.js
// Commands:
//   - list-sites: List all sites and export cartridge paths to CSV
//   - validate-cartridges-all: [WIP] Validate cartridges across all realms
//   - validate-site-xml: [WIP] Validate site.xml files match live SFCC

registerCartridgeCommands(program);

// ============================================================================
// REGISTER PREFERENCE COMMANDS
// ============================================================================
// Location: src/commands/preferences/preferences.js
// Commands:
//   - analyze-preferences: Full preference analysis workflow
//   - remove-preferences: Remove preferences marked for deletion
//   - restore-preferences: Restore site preferences from backup
//   - backup-site-preferences: Trigger backup job and download metadata

registerPreferenceCommands(program);

// ============================================================================
// REGISTER DEBUG COMMANDS
// ============================================================================
// Location: src/debug.js
// Commands: Various debug/test commands for development and troubleshooting

registerDebugCommands(program);

program.parse();
