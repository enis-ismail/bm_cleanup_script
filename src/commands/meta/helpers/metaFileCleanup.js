/**
 * Meta File Cleanup Helper
 *
 * Removes deleted preference attribute definitions and group assignments
 * from SFCC site template meta XML files in a sibling repository.
 *
 * Handles realm-specific vs. core (site_template) cleanup logic:
 * - Realm-specific: remove from realm path first
 * - Core: only remove if deleted from ALL realms
 * - Partial: move from core to the remaining realm(s) that still need it
 *
 * @module metaFileCleanup
 */

import fs from 'fs';
import path from 'path';
import { LOG_PREFIX } from '../../../config/constants.js';
import { logError } from '../../../scripts/loggingScript/log.js';
import {
    getSandboxConfig,
    getCoreSiteTemplatePath
} from '../../../config/helpers/helpers.js';

/**
 * Regex to detect a SitePreferences type-extension block inside XML content.
 */
const SITE_PREF_TYPE_EXTENSION = /type-id=["']SitePreferences["']/i;

// ============================================================================
// XML STRING MANIPULATION
// ============================================================================

/**
 * Remove an attribute-definition block from XML content.
 * Matches the full `<attribute-definition attribute-id="X">...</attribute-definition>` element.
 *
 * @param {string} xmlContent - Raw XML string
 * @param {string} attributeId - Attribute ID (without c_ prefix)
 * @returns {{ content: string, removed: boolean }} Updated XML and whether a removal occurred
 * @private
 */
function removeAttributeDefinition(xmlContent, attributeId) {
    // Match the full attribute-definition element including leading whitespace and trailing newline
    const pattern = new RegExp(
        `[ \\t]*<attribute-definition\\s+attribute-id="${escapeRegex(attributeId)}"[^>]*>` +
        '[\\s\\S]*?</attribute-definition>[ \\t]*\\n?',
        'g'
    );

    const result = xmlContent.replace(pattern, '');
    return { content: result, removed: result !== xmlContent };
}

/**
 * Remove an attribute group-assignment line from XML content.
 * Matches `<attribute attribute-id="X"/>` inside group-definitions.
 *
 * @param {string} xmlContent - Raw XML string
 * @param {string} attributeId - Attribute ID (without c_ prefix)
 * @returns {{ content: string, removed: boolean }} Updated XML and whether a removal occurred
 * @private
 */
function removeGroupAssignment(xmlContent, attributeId) {
    // Match self-closing attribute element with leading/trailing horizontal whitespace and newline
    const pattern = new RegExp(
        `[ \\t]*<attribute\\s+attribute-id="${escapeRegex(attributeId)}"\\s*/>[ \\t]*\\n?`,
        'g'
    );

    const result = xmlContent.replace(pattern, '');
    return { content: result, removed: result !== xmlContent };
}

/**
 * Remove an attribute ID from a meta file's XML content (both definition and group assignment).
 *
 * @param {string} xmlContent - Raw XML string
 * @param {string} attributeId - Attribute ID (without c_ prefix)
 * @returns {{ content: string, definitionRemoved: boolean, assignmentRemoved: boolean }}
 * @private
 */
function removeAttributeFromXml(xmlContent, attributeId) {
    const defResult = removeAttributeDefinition(xmlContent, attributeId);
    const grpResult = removeGroupAssignment(defResult.content, attributeId);

    return {
        content: grpResult.content,
        definitionRemoved: defResult.removed,
        assignmentRemoved: grpResult.removed
    };
}

/**
 * Remove a `<preference preference-id="X">` element from preferences.xml content.
 *
 * Handles three formats:
 *  - Self-closing: `<preference preference-id="X"/>`
 *  - Single-line:  `<preference preference-id="X">value</preference>`
 *  - Multi-line:   `<preference preference-id="X">\n<value>...</value>\n</preference>`
 *
 * @param {string} xmlContent - Raw preferences.xml content
 * @param {string} preferenceId - Preference ID (without c_ prefix)
 * @returns {{ content: string, removed: boolean }} Updated XML and whether a removal occurred
 * @private
 */
function removePreferenceValue(xmlContent, preferenceId) {
    const pattern = new RegExp(
        '[ \\t]*<preference\\s+preference-id="' + escapeRegex(preferenceId) + '"'
        + '(?:\\s*/>|[^>]*>[\\s\\S]*?</preference>)[ \\t]*\\n?',
        'g'
    );

    const result = xmlContent.replace(pattern, '');
    return { content: result, removed: result !== xmlContent };
}

/**
 * Check whether a meta file still has any attribute definitions or group assignments.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {boolean} True if the file is effectively empty (no definitions, no assignments)
 */
export function isMetaFileEmpty(xmlContent) {
    const hasDefinitions = /<attribute-definition\s/.test(xmlContent);
    const hasAssignments = /<attribute\s+attribute-id=/.test(xmlContent);
    return !hasDefinitions && !hasAssignments;
}

/**
 * Strip the `c_` prefix from an OCAPI attribute ID.
 * Meta XML files use the bare ID (e.g., `enableApplePay`), while OCAPI
 * returns `c_enableApplePay`.
 *
 * @param {string} id - Attribute ID (may or may not have c_ prefix)
 * @returns {string} Bare attribute ID
 */
export function stripCustomPrefix(id) {
    return id.startsWith('c_') ? id.slice(2) : id;
}

/**
 * Escape special regex characters in a string.
 *
 * @param {string} str - Input string
 * @returns {string} Regex-safe string
 * @private
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Re-indent a multi-line block to a target indentation level.
 * Strips the original leading whitespace from each line and applies
 * the new indent uniformly.
 *
 * @param {string} block - Multi-line text block
 * @param {string} indent - Target indentation string (e.g., 12 spaces)
 * @returns {string} Re-indented block
 * @private
 */
function reindentBlock(block, indent) {
    const lines = block.split('\n');

    // Determine the smallest non-empty leading whitespace in the block
    let minIndent = Infinity;
    for (const line of lines) {
        if (line.trim().length === 0) {
            continue;
        }
        const leading = line.match(/^[ \t]*/)[0].length;
        if (leading < minIndent) {
            minIndent = leading;
        }
    }

    if (minIndent === Infinity) {
        minIndent = 0;
    }

    return lines
        .map(line => {
            if (line.trim().length === 0) {
                return '';
            }
            return indent + line.slice(minIndent);
        })
        .join('\n');
}

// ============================================================================
// FILE SCANNING
// ============================================================================

/**
 * List all XML files in a directory that contain SitePreferences definitions.
 *
 * Scans every .xml file and returns only those whose content includes a
 * `<type-extension type-id="SitePreferences">` block. This catches all naming
 * conventions: meta.system.sitepreference.*, meta.system.Globale.xml,
 * metadata.system.*, system-objecttype-extensions-*, meta.custom.*, etc.
 *
 * @param {string} metaDir - Absolute path to a meta/ directory
 * @returns {string[]} Array of absolute file paths
 * @private
 */
function listSitePrefMetaFiles(metaDir) {
    if (!fs.existsSync(metaDir)) {
        return [];
    }

    return fs.readdirSync(metaDir)
        .filter(name => name.endsWith('.xml'))
        .map(name => path.join(metaDir, name))
        .filter(filePath => {
            const content = fs.readFileSync(filePath, 'utf-8');
            return SITE_PREF_TYPE_EXTENSION.test(content);
        });
}

/**
 * Find which meta file(s) in a directory contain a given attribute ID.
 * Searches both attribute-definition blocks and group-assignment lines.
 *
 * @param {string} metaDir - Absolute path to meta/ directory
 * @param {string} attributeId - Bare attribute ID (no c_ prefix)
 * @returns {string[]} Array of file paths that contain the attribute
 * @private
 */
function findFilesContainingAttribute(metaDir, attributeId) {
    const files = listSitePrefMetaFiles(metaDir);
    const matches = [];

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const idPattern = new RegExp(`attribute-id="${escapeRegex(attributeId)}"`, 'i');
        if (idPattern.test(content)) {
            matches.push(filePath);
        }
    }

    return matches;
}

/**
 * Recursively list all XML files under a directory.
 *
 * @param {string} rootDir - Directory to scan recursively
 * @returns {string[]} Absolute XML file paths
 * @private
 */
function listXmlFilesRecursively(rootDir) {
    if (!fs.existsSync(rootDir)) {
        return [];
    }

    const xmlFiles = [];
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);

        if (entry.isDirectory()) {
            xmlFiles.push(...listXmlFilesRecursively(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.xml')) {
            xmlFiles.push(fullPath);
        }
    }

    return xmlFiles;
}

/**
 * @typedef {Object} CrossRealmSitesScanResults
 * @property {string} sitesDir - Absolute path to scanned sites directory
 * @property {number} scannedFiles - Number of XML files scanned
 * @property {number} checkedPreferences - Number of unique preference IDs checked
 * @property {Map<string, string[]>} matchesByPreference - Bare preference ID -> matching repo-relative files
 */

/**
 * Scan repository `sites/` XML files for remaining mentions of selected preferences.
 *
 * This is intended for cross-realm validation after meta cleanup execution.
 * Any remaining `attribute-id="..."` matches indicate the preference still exists
 * somewhere under `sites/`.
 *
 * @param {Object} options - Scan options
 * @param {string} options.repoPath - Absolute path to sibling SFCC repository
 * @param {string[]} options.preferenceIds - Preference IDs to validate (with or without c_ prefix)
 * @returns {CrossRealmSitesScanResults} Scan summary and per-preference matches
 */
export function scanSitesForRemainingPreferences({ repoPath, preferenceIds }) {
    const sitesDir = path.join(repoPath, 'sites');
    const rawIds = Array.isArray(preferenceIds) ? preferenceIds : [];
    const barePreferenceIds = Array.from(new Set(rawIds.map(stripCustomPrefix))).sort();
    const matchesByPreference = new Map();

    if (barePreferenceIds.length === 0) {
        return {
            sitesDir,
            scannedFiles: 0,
            checkedPreferences: 0,
            matchesByPreference
        };
    }

    const xmlFiles = listXmlFilesRecursively(sitesDir);
    const idPatterns = new Map(
        barePreferenceIds.map(id => [
            id,
            new RegExp(
                `(?:attribute-id|preference-id)=["']${escapeRegex(id)}["']`, 'i'
            )
        ])
    );

    for (const xmlFilePath of xmlFiles) {
        const content = fs.readFileSync(xmlFilePath, 'utf-8');
        const repoRelativePath = path.relative(repoPath, xmlFilePath);

        for (const [preferenceId, pattern] of idPatterns) {
            if (!pattern.test(content)) {
                continue;
            }

            if (!matchesByPreference.has(preferenceId)) {
                matchesByPreference.set(preferenceId, []);
            }

            matchesByPreference.get(preferenceId).push(repoRelativePath);
        }
    }

    return {
        sitesDir,
        scannedFiles: xmlFiles.length,
        checkedPreferences: barePreferenceIds.length,
        matchesByPreference
    };
}

/**
 * Get the meta directory path for a realm.
 *
 * @param {string} repoPath - Absolute path to the sibling repository
 * @param {string} siteTemplatesPath - Relative site template path (e.g., "sites/site_template_apac")
 * @returns {string} Absolute path to meta/ directory
 */
export function getRealmMetaDir(repoPath, siteTemplatesPath) {
    return path.join(repoPath, siteTemplatesPath, 'meta');
}

/**
 * Get the core (shared) meta directory path.
 * Uses the `coreSiteTemplatePath` value from config.json.
 *
 * @param {string} repoPath - Absolute path to the sibling repository
 * @returns {string} Absolute path to core meta/ directory
 */
export function getCoreMetaDir(repoPath) {
    return path.join(repoPath, getCoreSiteTemplatePath(), 'meta');
}

// ============================================================================
// CLEANUP PLAN BUILDER
// ============================================================================

/**
 * @typedef {Object} MetaCleanupAction
 * @property {'remove'|'move-to-realm'|'delete-file'|'create-realm-file'|'skip'} type
 * @property {string} attributeId - Bare attribute ID
 * @property {string} filePath - Absolute path to the meta file
 * @property {string} [targetFilePath] - For move operations, the destination file
 * @property {string} [realm] - Realm this action applies to
 * @property {string} [reason] - Human-readable explanation
 */

/**
 * @typedef {Object} MetaCleanupPlan
 * @property {MetaCleanupAction[]} actions - Ordered list of actions to perform
 * @property {string[]} warnings - Non-fatal issues encountered during planning
 * @property {string[]} skipped - Attribute IDs not found in any meta file
 * @property {Map<string, string[]>} realmPreferenceMap - Input map for reference
 * @property {string} repoPath - Repository path
 */

/**
 * Build a cleanup plan for removing preferences from meta files.
 *
 * Given a map of realm → preference IDs to delete, determines what actions
 * are needed in both realm-specific and core meta directories.
 *
 * @param {string} repoPath - Absolute path to the sibling SFCC repository
 * @param {Map<string, string[]>} realmPreferenceMap - Map of realm → preference IDs to delete
 * @param {string[]} allConfiguredRealms - All realm names in config (for core removal decisions)
 * @param {Object} [options] - Planning options
 * @param {boolean} [options.crossRealm=false] - When true, skip move logic (cross-realm means
 *   all attributes are confirmed unused everywhere — just remove, never move to remaining realms)
 * @returns {MetaCleanupPlan} Plan describing all file operations needed
 */
export function buildMetaCleanupPlan(repoPath, realmPreferenceMap, allConfiguredRealms, { crossRealm = false } = {}) {
    const actions = [];
    const warnings = [];
    const skipped = [];

    const coreMetaDir = getCoreMetaDir(repoPath);

    // Collect all unique attribute IDs and which realms want them deleted
    const attrToDeletedRealms = new Map();

    for (const [realm, preferenceIds] of realmPreferenceMap) {
        for (const rawId of preferenceIds) {
            const bareId = stripCustomPrefix(rawId);
            if (!attrToDeletedRealms.has(bareId)) {
                attrToDeletedRealms.set(bareId, new Set());
            }
            attrToDeletedRealms.get(bareId).add(realm);
        }
    }

    // Process each attribute
    for (const [bareId, deletedRealms] of attrToDeletedRealms) {
        // Cross-realm mode: attributes come from the cross-realm intersection file,
        // meaning they are confirmed unused across ALL realms — always treat as
        // "deleted from all" so we only remove (never move to remaining realms).
        const deletedFromAll = crossRealm
            || allConfiguredRealms.every(r => deletedRealms.has(r));
        const remainingRealms = allConfiguredRealms.filter(r => !deletedRealms.has(r));

        // Step 1: Check realm-specific meta directories
        for (const realm of deletedRealms) {
            const realmConfig = getSandboxConfig(realm);
            const realmMetaDir = getRealmMetaDir(repoPath, realmConfig.siteTemplatesPath);
            const realmFiles = findFilesContainingAttribute(realmMetaDir, bareId);

            for (const filePath of realmFiles) {
                actions.push({
                    type: 'remove',
                    attributeId: bareId,
                    filePath,
                    realm,
                    reason: `Remove from realm ${realm} meta`
                });
            }
        }

        // Step 2: Handle core meta directory
        const coreFiles = findFilesContainingAttribute(coreMetaDir, bareId);

        if (coreFiles.length === 0) {
            // Not in core — nothing more to do
            if (actions.filter(a => a.attributeId === bareId).length === 0) {
                skipped.push(bareId);
                warnings.push(
                    `${bareId}: not found in any meta file (may be OCAPI-only or in a non-standard location)`
                );
            }
            continue;
        }

        if (deletedFromAll) {
            // Deleted from every realm → remove from core
            for (const filePath of coreFiles) {
                actions.push({
                    type: 'remove',
                    attributeId: bareId,
                    filePath,
                    realm: 'CORE',
                    reason: 'Deleted from all realms — remove from core'
                });
            }
        } else if (remainingRealms.length >= 1) {
            // Deleted from some realms but not all → move from core to remaining realm folders
            for (const coreFilePath of coreFiles) {
                const coreFileName = path.basename(coreFilePath);

                for (const remainingRealm of remainingRealms) {
                    const remainingConfig = getSandboxConfig(remainingRealm);
                    const remainingMetaDir = getRealmMetaDir(repoPath, remainingConfig.siteTemplatesPath);
                    const targetFilePath = path.join(remainingMetaDir, coreFileName);

                    // Check if the remaining realm already has this file
                    const realmAlreadyHas = findFilesContainingAttribute(remainingMetaDir, bareId);

                    if (realmAlreadyHas.length === 0) {
                        // Need to create/copy file for this realm and add the attribute
                        actions.push({
                            type: 'create-realm-file',
                            attributeId: bareId,
                            filePath: coreFilePath,
                            targetFilePath,
                            realm: remainingRealm,
                            reason: `Copy from core to ${remainingRealm} — attribute still needed there`
                        });
                    }
                    // If realm already has the attribute, no action needed
                }

                // Remove from core after ensuring remaining realms have it
                actions.push({
                    type: 'remove',
                    attributeId: bareId,
                    filePath: coreFilePath,
                    realm: 'CORE',
                    reason: `Removed from ${[...deletedRealms].join(', ')} — move to remaining realm(s)`
                });
            }
        }
    }

    return { actions, warnings, skipped, realmPreferenceMap, repoPath };
}

// ============================================================================
// PLAN EXECUTION
// ============================================================================

/**
 * Execute a meta cleanup plan.
 *
 * @param {MetaCleanupPlan} plan - The plan built by buildMetaCleanupPlan
 * @param {Object} [options] - Execution options
 * @param {boolean} [options.dryRun=false] - If true, only log what would happen
 * @returns {{
 *   filesModified: string[],
 *   filesDeleted: string[],
 *   filesCreated: string[],
 *   errors: Array<{action: MetaCleanupAction, error: Error}>
 * }}
 */
export function executeMetaCleanupPlan(plan, { dryRun = false } = {}) {
    const filesModified = new Set();
    const filesDeleted = new Set();
    const filesCreated = new Set();
    const errors = [];
    const prefix = dryRun ? '[DRY-RUN] ' : '';

    // Group actions by file for efficient processing.
    // Process create-realm-file actions first (copy core files before removing from core).
    const createActions = plan.actions.filter(a => a.type === 'create-realm-file');
    const removeActions = plan.actions.filter(a => a.type === 'remove');

    // Phase 1: Create realm files (copy from core and keep only relevant attributes)
    for (const action of createActions) {
        try {
            console.log(
                `${prefix}${LOG_PREFIX.INFO} CREATE: ${path.basename(action.targetFilePath)}`
                + ` in ${action.realm} (attr: ${action.attributeId})`
            );

            if (!dryRun) {
                createRealmMetaFile(action.filePath, action.targetFilePath, action.attributeId);
                filesCreated.add(action.targetFilePath);
            }
        } catch (error) {
            logError(`Failed to create realm file: ${error.message}`);
            errors.push({ action, error });
        }
    }

    // Phase 2: Remove attributes from files (realm-specific and core)
    // Group removes by file path to process each file only once
    const removesByFile = new Map();
    for (const action of removeActions) {
        if (!removesByFile.has(action.filePath)) {
            removesByFile.set(action.filePath, []);
        }
        removesByFile.get(action.filePath).push(action);
    }

    for (const [filePath, fileActions] of removesByFile) {
        try {
            if (!fs.existsSync(filePath)) {
                console.log(
                    `${prefix}${LOG_PREFIX.WARNING} SKIP: ${path.basename(filePath)} — file not found`
                );
                continue;
            }

            let content = fs.readFileSync(filePath, 'utf-8');
            const attrIds = fileActions.map(a => a.attributeId);
            let anyRemoved = false;

            for (const attrId of attrIds) {
                const result = removeAttributeFromXml(content, attrId);
                content = result.content;

                const what = [
                    result.definitionRemoved ? 'definition' : null,
                    result.assignmentRemoved ? 'group-ref' : null
                ].filter(Boolean).join(' + ');

                if (result.definitionRemoved || result.assignmentRemoved) {
                    const realmLabel = fileActions[0].realm;
                    console.log(
                        `${prefix}${LOG_PREFIX.INFO} REMOVE: ${attrId} (${what})`
                        + ` from ${path.basename(filePath)} [${realmLabel}]`
                    );
                    anyRemoved = true;
                }
            }

            if (!anyRemoved) {
                continue;
            }

            // Check if file is now empty
            if (isMetaFileEmpty(content)) {
                console.log(
                    `${prefix}${LOG_PREFIX.INFO} DELETE: ${path.basename(filePath)}`
                    + ' — no definitions or assignments remaining'
                );
                if (!dryRun) {
                    fs.unlinkSync(filePath);
                    filesDeleted.add(filePath);
                }
            } else {
                if (!dryRun) {
                    fs.writeFileSync(filePath, content, 'utf-8');
                    filesModified.add(filePath);
                }
            }
        } catch (error) {
            logError(`Failed to process ${path.basename(filePath)}: ${error.message}`);
            errors.push({ action: fileActions[0], error });
        }
    }

    return {
        filesModified: [...filesModified],
        filesDeleted: [...filesDeleted],
        filesCreated: [...filesCreated],
        errors
    };
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Copy a core meta file to a realm directory, keeping only the attribute(s)
 * that the realm still needs.
 *
 * If the target file already exists, the attribute's definition and group
 * assignment are appended into the existing file's sections.
 *
 * @param {string} coreFilePath - Absolute path to the core meta file
 * @param {string} targetFilePath - Absolute path to the realm meta file
 * @param {string} attributeId - Bare attribute ID to keep
 * @private
 */
function createRealmMetaFile(coreFilePath, targetFilePath, attributeId) {
    const targetDir = path.dirname(targetFilePath);

    // Ensure the meta directory exists
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const coreContent = fs.readFileSync(coreFilePath, 'utf-8');

    if (fs.existsSync(targetFilePath)) {
        // Target file already exists — append the attribute definition and group assignment
        appendAttributeToExistingFile(targetFilePath, coreContent, attributeId);
        return;
    }

    // Extract only the target attribute's definition and group assignment from core
    const extractedDef = extractAttributeDefinition(coreContent, attributeId);
    const extractedGrp = extractGroupAssignment(coreContent, attributeId);
    const groupBlock = extractContainingGroup(coreContent, attributeId);

    // Build a minimal meta file
    let newContent = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">\n'
        + '    <type-extension type-id="SitePreferences">\n';

    if (extractedDef) {
        const reindentedDef = reindentBlock(extractedDef, '            ');
        newContent += '        <custom-attribute-definitions>\n'
            + `${reindentedDef}\n`
            + '        </custom-attribute-definitions>\n';
    }

    if (groupBlock) {
        const reindentedGroup = reindentBlock(groupBlock, '            ');
        newContent += '        <group-definitions>\n'
            + `${reindentedGroup}\n`
            + '        </group-definitions>\n';
    } else if (extractedGrp) {
        // Fallback: create a minimal group with just this attribute
        newContent += '        <group-definitions>\n'
            + '            <attribute-group group-id="Migrated">\n'
            + '                <display-name xml:lang="x-default">Migrated</display-name>\n'
            + `                ${extractedGrp.trim()}\n`
            + '            </attribute-group>\n'
            + '        </group-definitions>\n';
    }

    newContent += '    </type-extension>\n</metadata>\n';

    fs.writeFileSync(targetFilePath, newContent, 'utf-8');
}

/**
 * Extract the full `<attribute-definition>` block for a given attribute ID.
 *
 * @param {string} xmlContent - Raw XML string
 * @param {string} attributeId - Bare attribute ID
 * @returns {string|null} The matched block or null
 * @private
 */
function extractAttributeDefinition(xmlContent, attributeId) {
    const pattern = new RegExp(
        `([ \\t]*<attribute-definition\\s+attribute-id="${escapeRegex(attributeId)}"[^>]*>`
        + '[\\s\\S]*?</attribute-definition>)',
        'i'
    );
    const match = xmlContent.match(pattern);
    return match ? match[1] : null;
}

/**
 * Extract the `<attribute attribute-id="X"/>` line for a given attribute ID.
 *
 * @param {string} xmlContent - Raw XML string
 * @param {string} attributeId - Bare attribute ID
 * @returns {string|null} The matched line or null
 * @private
 */
function extractGroupAssignment(xmlContent, attributeId) {
    const pattern = new RegExp(
        `([ \\t]*<attribute\\s+attribute-id="${escapeRegex(attributeId)}"\\s*/>)`,
        'i'
    );
    const match = xmlContent.match(pattern);
    return match ? match[1] : null;
}

/**
 * Extract the full `<attribute-group>` block that contains a given attribute ID.
 *
 * @param {string} xmlContent - Raw XML string
 * @param {string} attributeId - Bare attribute ID
 * @returns {string|null} The matched group block or null
 * @private
 */
function extractContainingGroup(xmlContent, attributeId) {
    const pattern = new RegExp(
        '([ \\t]*<attribute-group[^>]*>[\\s\\S]*?'
        + `<attribute\\s+attribute-id="${escapeRegex(attributeId)}"\\s*/>`
        + '[\\s\\S]*?</attribute-group>)',
        'i'
    );
    const match = xmlContent.match(pattern);
    return match ? match[1] : null;
}

/**
 * Append an attribute definition and group assignment into an existing realm meta file.
 *
 * @param {string} targetFilePath - The existing realm meta file
 * @param {string} sourceContent - The core file content to extract from
 * @param {string} attributeId - Bare attribute ID
 * @private
 */
function appendAttributeToExistingFile(targetFilePath, sourceContent, attributeId) {
    let targetContent = fs.readFileSync(targetFilePath, 'utf-8');
    const extractedDef = extractAttributeDefinition(sourceContent, attributeId);
    const extractedGrp = extractGroupAssignment(sourceContent, attributeId);

    // Insert definition before </custom-attribute-definitions>
    if (extractedDef) {
        const defClosePattern = /([ \t]*)<\/custom-attribute-definitions>/;
        const defMatch = targetContent.match(defClosePattern);
        if (defMatch) {
            const defIndent = defMatch[1]; // indentation of closing tag
            const reindentedDef = reindentBlock(extractedDef, defIndent + '    ');
            targetContent = targetContent.replace(
                defClosePattern,
                `${reindentedDef}\n${defIndent}</custom-attribute-definitions>`
            );
        }
    }

    // Insert group assignment before the last </attribute-group>
    if (extractedGrp) {
        const grpClosePattern = /([ \t]*)<\/attribute-group>(?![\s\S]*<\/attribute-group>)/;
        const grpMatch = targetContent.match(grpClosePattern);
        if (grpMatch) {
            const grpIndent = grpMatch[1]; // indentation of </attribute-group>
            const attrIndent = grpIndent + '    '; // one level deeper
            const trimmedGrp = extractedGrp.trim();
            targetContent = targetContent.replace(
                grpClosePattern,
                `${attrIndent}${trimmedGrp}\n${grpIndent}</attribute-group>`
            );
        }
    }

    fs.writeFileSync(targetFilePath, targetContent, 'utf-8');
}

// ============================================================================
// PLAN FORMATTING
// ============================================================================

/**
 * Format a cleanup plan as a human-readable summary string.
 *
 * @param {MetaCleanupPlan} plan - The plan to format
 * @returns {string} Multi-line summary
 */
export function formatCleanupPlan(plan) {
    const lines = [];
    lines.push('');
    lines.push('═'.repeat(80));
    lines.push(' META FILE CLEANUP PLAN');
    lines.push('═'.repeat(80));
    lines.push(`  Repository: ${plan.repoPath}`);
    lines.push(`  Actions: ${plan.actions.length}`);
    lines.push(`  Warnings: ${plan.warnings.length}`);
    lines.push(`  Skipped (not found): ${plan.skipped.length}`);
    lines.push('');

    if (plan.actions.length > 0) {
        lines.push('─'.repeat(80));
        lines.push(' PLANNED ACTIONS');
        lines.push('─'.repeat(80));

        // Group by type
        const removes = plan.actions.filter(a => a.type === 'remove');
        const creates = plan.actions.filter(a => a.type === 'create-realm-file');

        if (creates.length > 0) {
            lines.push('');
            lines.push(`  📁 CREATE realm files (${creates.length}):`);
            for (const a of creates) {
                lines.push(`    → ${path.basename(a.targetFilePath)} [${a.realm}]`);
                lines.push(`      Attr: ${a.attributeId} — ${a.reason}`);
            }
        }

        if (removes.length > 0) {
            lines.push('');
            lines.push(`  🗑️  REMOVE attributes (${removes.length}):`);

            // Group by file
            const byFile = new Map();
            for (const a of removes) {
                const key = `${a.filePath}|${a.realm}`;
                if (!byFile.has(key)) {
                    byFile.set(key, { filePath: a.filePath, realm: a.realm, attrs: [] });
                }
                byFile.get(key).attrs.push(a.attributeId);
            }

            for (const { filePath, realm, attrs } of byFile.values()) {
                lines.push(`    → ${path.basename(filePath)} [${realm}] (${attrs.length} attr(s))`);
                for (const id of attrs) {
                    lines.push(`      - ${id}`);
                }
            }
        }
    }

    if (plan.skipped.length > 0) {
        lines.push('');
        lines.push('─'.repeat(80));
        lines.push(' SKIPPED (not found in any meta file)');
        lines.push('─'.repeat(80));
        for (const id of plan.skipped) {
            lines.push(`  ⚠ ${id}`);
        }
    }

    if (plan.warnings.length > 0) {
        lines.push('');
        lines.push('─'.repeat(80));
        lines.push(' WARNINGS');
        lines.push('─'.repeat(80));
        for (const w of plan.warnings) {
            lines.push(`  ⚠ ${w}`);
        }
    }

    lines.push('');
    lines.push('═'.repeat(80));
    return lines.join('\n');
}

/**
 * Format execution results as a human-readable summary.
 *
 * @param {Object} results - Results from executeMetaCleanupPlan
 * @returns {string} Multi-line summary
 */
export function formatExecutionResults(results) {
    const lines = [];
    lines.push('');
    lines.push('═'.repeat(80));
    lines.push(' META FILE CLEANUP RESULTS');
    lines.push('═'.repeat(80));
    lines.push(`  Files modified: ${results.filesModified.length}`);
    lines.push(`  Files deleted:  ${results.filesDeleted.length}`);
    lines.push(`  Files created:  ${results.filesCreated.length}`);
    lines.push(`  Errors:         ${results.errors.length}`);

    if (results.filesCreated.length > 0) {
        lines.push('');
        lines.push('  Created:');
        for (const f of results.filesCreated) {
            lines.push(`    + ${path.basename(f)}`);
        }
    }

    if (results.filesModified.length > 0) {
        lines.push('');
        lines.push('  Modified:');
        for (const f of results.filesModified) {
            lines.push(`    ~ ${path.basename(f)}`);
        }
    }

    if (results.filesDeleted.length > 0) {
        lines.push('');
        lines.push('  Deleted:');
        for (const f of results.filesDeleted) {
            lines.push(`    - ${path.basename(f)}`);
        }
    }

    if (results.errors.length > 0) {
        lines.push('');
        lines.push('  Errors:');
        for (const { action, error } of results.errors) {
            lines.push(`    ✗ ${action.attributeId}: ${error.message}`);
        }
    }

    lines.push('═'.repeat(80));
    return lines.join('\n');
}

/**
 * Format cross-realm sites scan results as a human-readable summary.
 *
 * @param {CrossRealmSitesScanResults} results - Results from scanSitesForRemainingPreferences
 * @returns {string} Multi-line summary
 */
/**
 * Remove preference value entries from all preferences.xml files under sites/.
 *
 * After removing attribute definitions from meta XML, the corresponding
 * `<preference preference-id="X">` entries in site preference data files
 * must also be removed — otherwise preference imports break or silently
 * drop the setting.
 *
 * @param {Object} options
 * @param {string} options.repoPath - Absolute path to sibling SFCC repository
 * @param {string[]} options.preferenceIds - Preference IDs to remove (with or without c_ prefix)
 * @param {boolean} [options.dryRun=false] - If true, only report what would be removed
 * @returns {{ filesModified: string[], totalRemoved: number, details: Array<{file: string, removed: string[]}> }}
 */
export function removePreferenceValuesFromSites({ repoPath, preferenceIds, dryRun = false }) {
    const sitesDir = path.join(repoPath, 'sites');
    const rawIds = Array.isArray(preferenceIds) ? preferenceIds : [];
    const bareIds = Array.from(new Set(rawIds.map(stripCustomPrefix))).sort();
    const filesModified = [];
    const details = [];
    let totalRemoved = 0;
    const prefix = dryRun ? '[DRY-RUN] ' : '';

    if (bareIds.length === 0) {
        return { filesModified, totalRemoved, details };
    }

    // Only scan preferences.xml files (not meta files)
    const prefFiles = listXmlFilesRecursively(sitesDir)
        .filter(f => path.basename(f) === 'preferences.xml');

    for (const filePath of prefFiles) {
        let content = fs.readFileSync(filePath, 'utf-8');
        const removedInFile = [];

        for (const id of bareIds) {
            const result = removePreferenceValue(content, id);
            if (result.removed) {
                content = result.content;
                removedInFile.push(id);
            }
        }

        if (removedInFile.length === 0) {
            continue;
        }

        const relPath = path.relative(repoPath, filePath);
        console.log(
            `${prefix}${LOG_PREFIX.INFO} PREF-VALUE: removed `
            + `${removedInFile.length} preference(s) from ${relPath}`
        );

        if (!dryRun) {
            fs.writeFileSync(filePath, content, 'utf-8');
        }

        filesModified.push(relPath);
        totalRemoved += removedInFile.length;
        details.push({ file: relPath, removed: removedInFile });
    }

    return { filesModified, totalRemoved, details };
}

/**
 * Format preference value removal results for console output.
 *
 * @param {Object} results - Return value from removePreferenceValuesFromSites
 * @param {string[]} results.filesModified - Relative paths of modified files
 * @param {number} results.totalRemoved - Total preference values removed
 * @param {Array<{file: string, removed: string[]}>} results.details - Per-file details
 * @returns {string} Formatted output string
 */
export function formatPreferenceValueResults(results) {
    const lines = [];

    lines.push('');
    lines.push('─'.repeat(80));
    lines.push(' PREFERENCE VALUE CLEANUP (preferences.xml)');
    lines.push('─'.repeat(80));

    if (results.totalRemoved === 0) {
        lines.push('  ✓ No orphaned preference values found in any preferences.xml files.');
        lines.push('─'.repeat(80));
        return lines.join('\n');
    }

    lines.push(`  Files modified: ${results.filesModified.length}`);
    lines.push(`  Total preference values removed: ${results.totalRemoved}`);
    lines.push('');

    for (const { file, removed } of results.details) {
        lines.push(`    ${file}`);
        for (const id of removed) {
            lines.push(`      - ${id}`);
        }
    }

    lines.push('─'.repeat(80));
    return lines.join('\n');
}

export function formatSitesScanResults(results) {
    const lines = [];
    const unresolvedPreferenceIds = [...results.matchesByPreference.keys()].sort();
    const unresolvedCount = unresolvedPreferenceIds.length;

    lines.push('');
    lines.push('═'.repeat(80));
    lines.push(' CROSS-REALM RESIDUAL SCAN (sites/)');
    lines.push('═'.repeat(80));
    lines.push(`  Sites directory: ${results.sitesDir}`);
    lines.push(`  XML files scanned: ${results.scannedFiles}`);
    lines.push(`  Preferences checked: ${results.checkedPreferences}`);
    lines.push(`  Preferences still found: ${unresolvedCount}`);

    if (unresolvedCount === 0) {
        lines.push('');
        lines.push('  ✓ PASS: No scanned cross-realm preference IDs were found under sites/.');
        lines.push('═'.repeat(80));
        return lines.join('\n');
    }

    lines.push('');
    lines.push('  ✗ FAIL: Remaining preference mentions were found:');

    for (const preferenceId of unresolvedPreferenceIds) {
        const files = results.matchesByPreference.get(preferenceId) || [];
        lines.push(`    - ${preferenceId} (${files.length} file(s))`);
        for (const filePath of files.slice(0, 5)) {
            lines.push(`      • ${filePath}`);
        }
        if (files.length > 5) {
            lines.push(`      • ... and ${files.length - 5} more`);
        }
    }

    lines.push('═'.repeat(80));
    return lines.join('\n');
}
