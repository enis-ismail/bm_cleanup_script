import { testMetaCleanup } from './actions/testMetaCleanup.js';
import { metaCleanup } from './actions/metaCleanup.js';

// ============================================================================
// META COMMANDS REGISTRATION
// Register all meta file management commands with the CLI program
// ============================================================================

/**
 * Register meta file management commands with the CLI program.
 * @param {import('commander').Command} program - Commander.js program instance
 */
export function registerMetaCommands(program) {
    program
        .command('test-meta-cleanup')
        .description('Test meta file cleanup — preview/execute removal of preference definitions from repo XML')
        .option('--dry-run', 'Preview changes without modifying files (default)', true)
        .option('--execute', 'Actually modify files (disables dry-run)')
        .action(async (options) => testMetaCleanup(options));

    program
        .command('meta-cleanup')
        .description('Full meta cleanup workflow — create branch, remove preference definitions, stage & commit')
        .action(metaCleanup);
}
