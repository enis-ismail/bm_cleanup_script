import { metaCleanup } from './actions/metaCleanup.js';
import { detectOrphans } from './actions/orphanDetection.js';

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
        .command('meta-cleanup')
        .description('Full meta cleanup workflow — create branch, remove preference definitions, stage & commit')
        .action(metaCleanup);

    program
        .command('detect-orphans')
        .description('Compare BM metadata backup against repo meta XMLs to find orphan preferences')
        .action(detectOrphans);
}
