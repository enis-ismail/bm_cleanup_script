/**
 * Demo Scenario Helper
 * Orchestrates a deterministic demo/test scenario that creates test attributes,
 * pushes them to realms, sets up whitelist entries, and places fake meta/code
 * artifacts in a sibling repo for analysis flows to discover.
 *
 * @module demoScenarioHelper
 */

import fs from 'fs';
import path from 'path';
import { DIRECTORIES, FILE_PATTERNS, IDENTIFIERS, LOG_PREFIX } from '../../../config/constants.js';
import { getInstanceType, getCoreSiteTemplatePath } from '../../../config/helpers/helpers.js';
import { restorePreferencesForRealm } from '../../preferences/helpers/restoreHelper.js';
import { loadBackupFile } from '../../../io/backupUtils.js';
import {
    loadWhitelist,
    saveWhitelist,
    addToWhitelist
} from '../../setup/helpers/whitelistHelper.js';
import { deletePreferencesForRealms } from '../../preferences/helpers/deleteHelpers.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEMO_PREFIX = 'DemoTest';

const DEMO_ATTRIBUTES = {
    shared: {
        id: `${DEMO_PREFIX}SharedAttribute`,
        display_name: { default: `${DEMO_PREFIX} Shared Attribute` },
        description: { default: 'Shared demo attribute created by setup-demo command.' },
        value_type: 'string',
        default_value: { value: 'demo_default' },
        mandatory: false,
        localizable: false,
        multi_value_type: false,
        visible: true,
        queryable: true,
        searchable: false,
        site_specific: false,
        min_length: 0
    },
    realmSpecific: (realm) => ({
        id: `${DEMO_PREFIX}${realm}Attribute`,
        display_name: { default: `${DEMO_PREFIX} ${realm} Attribute` },
        description: { default: `Demo attribute specific to the ${realm} realm.` },
        value_type: 'string',
        default_value: { value: `default_${realm.toLowerCase()}` },
        mandatory: false,
        localizable: false,
        multi_value_type: false,
        visible: true,
        queryable: true,
        searchable: false,
        site_specific: false,
        min_length: 0
    })
};

const DEMO_GROUP_ID = `${DEMO_PREFIX}Group`;
const DEMO_GROUP_DISPLAY_NAME = `${DEMO_PREFIX} Group`;

const SCENARIO_STATE_FILE = 'demo_scenario_state.json';
const DEMO_META_FILENAME = 'meta.demo.sitepreferences.xml';
const DEMO_CODE_FILENAME = 'demoPreferenceReferences.js';

// ============================================================================
// BACKUP GENERATION
// ============================================================================

/**
 * Build a deterministic backup JSON payload for a realm.
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @returns {Object} Backup object matching the standard backup shape
 */
export function buildDemoBackup(realm, instanceType) {
    const sharedAttr = { ...DEMO_ATTRIBUTES.shared };
    const realmAttr = DEMO_ATTRIBUTES.realmSpecific(realm);
    const attributeIds = [sharedAttr.id, realmAttr.id];

    return {
        backup_date: new Date().toISOString(),
        realm,
        instance_type: instanceType,
        object_type: IDENTIFIERS.SITE_PREFERENCES,
        total_attributes: 2,
        attributes: [sharedAttr, realmAttr],
        attribute_groups: [
            {
                group_id: DEMO_GROUP_ID,
                group_display_name: DEMO_GROUP_DISPLAY_NAME,
                attributes: attributeIds
            }
        ],
        site_values: {}
    };
}

/**
 * Write demo backup files for all selected realms.
 * @param {string[]} realms - Realm names
 * @param {string} instanceType - Instance type
 * @returns {Map<string, string>} Map of realm → backup file path
 */
export function writeDemoBackups(realms, instanceType) {
    const backupDate = new Date().toISOString().split('T')[0];
    const backupPaths = new Map();

    for (const realm of realms) {
        const backup = buildDemoBackup(realm, instanceType);
        const backupDir = path.join(
            process.cwd(), DIRECTORIES.BACKUP, instanceType
        );

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const fileName = `${realm}_${IDENTIFIERS.SITE_PREFERENCES}`
            + `${FILE_PATTERNS.BACKUP_SUFFIX}${backupDate}.json`;
        const filePath = path.join(backupDir, fileName);

        fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');
        console.log(`  ${LOG_PREFIX.INFO} Backup written: ${path.basename(filePath)}`);
        backupPaths.set(realm, filePath);
    }

    return backupPaths;
}

// ============================================================================
// RESTORE (PUSH TO REALM)
// ============================================================================

/**
 * Restore demo attributes to all selected realms using backup files.
 * @param {Map<string, string>} backupPaths - Map of realm → backup file path
 * @param {string} instanceType - Instance type
 * @returns {Promise<{totalRestored: number, totalFailed: number}>}
 */
export async function restoreDemoAttributes(backupPaths, instanceType) {
    let totalRestored = 0;
    let totalFailed = 0;

    for (const [realm, backupFilePath] of backupPaths) {
        console.log(`\n  Restoring demo attributes to ${realm}...`);
        const backup = await loadBackupFile(backupFilePath);
        const preferenceIds = backup.attributes.map(a => a.id);

        const result = await restorePreferencesForRealm({
            preferenceIds,
            backup,
            objectType: IDENTIFIERS.SITE_PREFERENCES,
            instanceType,
            realm
        });

        totalRestored += result.restored;
        totalFailed += result.failed;
    }

    return { totalRestored, totalFailed };
}

// ============================================================================
// WHITELIST MANAGEMENT
// ============================================================================

/**
 * Get the list of demo attribute IDs for all selected realms.
 * @param {string[]} realms - Realm names
 * @returns {string[]} Array of demo attribute IDs
 */
export function getDemoAttributeIds(realms) {
    const ids = [DEMO_ATTRIBUTES.shared.id];
    for (const realm of realms) {
        ids.push(DEMO_ATTRIBUTES.realmSpecific(realm).id);
    }
    return ids;
}

/**
 * Replace the whitelist with demo-only entries.
 * Returns the previous whitelist snapshot for teardown restoration.
 * @param {string[]} realms - Realm names
 * @returns {Object} Previous whitelist config snapshot
 */
export function replaceDemoWhitelist(realms) {
    const previousWhitelist = loadWhitelist();

    // Clear and replace with demo entries
    const demoConfig = { description: 'Demo scenario whitelist', whitelist: [] };
    saveWhitelist(demoConfig);

    const attributeIds = getDemoAttributeIds(realms);
    for (const id of attributeIds) {
        addToWhitelist({
            id,
            type: 'exact',
            reason: 'Demo scenario test attribute'
        });
    }

    console.log(`  ${LOG_PREFIX.INFO} Whitelist replaced with ${attributeIds.length} demo entries`);
    return previousWhitelist;
}

/**
 * Restore the whitelist to a previous snapshot.
 * @param {Object} previousWhitelist - Whitelist config snapshot
 */
export function restorePreviousWhitelist(previousWhitelist) {
    saveWhitelist(previousWhitelist);
    const entryCount = previousWhitelist?.whitelist?.length || 0;
    console.log(`  ${LOG_PREFIX.INFO} Whitelist restored (${entryCount} entries)`);
}

// ============================================================================
// META XML ARTIFACT
// ============================================================================

/**
 * Build the demo meta XML content defining the test attributes.
 * @param {string[]} realms - Realm names
 * @returns {string} XML content
 */
export function buildDemoMetaXml(realms) {
    const attributeIds = getDemoAttributeIds(realms);

    const definitions = attributeIds.map(id => {
        const displayName = id.replace(/([A-Z])/g, ' $1').trim();
        return [
            `        <attribute-definition attribute-id="${id}">`,
            `            <display-name xml:lang="x-default">${displayName}</display-name>`,
            `            <type>string</type>`,
            `            <mandatory-flag>false</mandatory-flag>`,
            `            <externally-managed-flag>false</externally-managed-flag>`,
            `        </attribute-definition>`
        ].join('\n');
    }).join('\n');

    const groupAssignments = attributeIds
        .map(id => `            <attribute attribute-id="${id}"/>`)
        .join('\n');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">',
        '    <type-extension type-id="SitePreferences">',
        '        <custom-attribute-definitions>',
        definitions,
        '        </custom-attribute-definitions>',
        '        <group-definitions>',
        `            <attribute-group group-id="${DEMO_GROUP_ID}">`,
        `                <display-name xml:lang="x-default">${DEMO_GROUP_DISPLAY_NAME}</display-name>`,
        groupAssignments,
        '            </attribute-group>',
        '        </group-definitions>',
        '    </type-extension>',
        '</metadata>'
    ].join('\n');
}

/**
 * Write the demo meta XML into the core site_template of the sibling repo.
 * @param {string} repoPath - Absolute path to the sibling SFCC repo
 * @param {string[]} realms - Realm names
 * @returns {string} Absolute path to the created meta file
 */
export function writeDemoMetaFile(repoPath, realms) {
    const corePath = getCoreSiteTemplatePath();
    const metaDir = path.join(repoPath, corePath, 'meta');

    if (!fs.existsSync(metaDir)) {
        fs.mkdirSync(metaDir, { recursive: true });
    }

    const filePath = path.join(metaDir, DEMO_META_FILENAME);
    const xmlContent = buildDemoMetaXml(realms);

    fs.writeFileSync(filePath, xmlContent, 'utf-8');
    console.log(`  ${LOG_PREFIX.INFO} Meta file written: ${filePath}`);
    return filePath;
}

// ============================================================================
// CODE REFERENCE ARTIFACT
// ============================================================================

/**
 * Build fake code content that the scanner will detect as preference usage.
 * Uses real access patterns (.custom.prefId, bracket notation) so the
 * code scanner recognizes them.
 * @param {string} realmForUsage - The realm whose attribute should be "used"
 * @returns {string} JavaScript file content
 */
export function buildDemoCodeReference(realmForUsage) {
    const sharedId = DEMO_ATTRIBUTES.shared.id;
    const realmId = DEMO_ATTRIBUTES.realmSpecific(realmForUsage).id;

    return [
        "'use strict';",
        '',
        '/**',
        ' * Demo preference references — generated by setup-demo.',
        ' * This file simulates code usage of demo test attributes.',
        ' * DO NOT use in production.',
        ' */',
        '',
        '// Shared attribute reference (detected by code scanner)',
        `var sharedValue = pdict.CurrentSite.preferences.custom.${sharedId};`,
        '',
        `// Realm-specific attribute reference for ${realmForUsage}`,
        `var realmValue = pdict.CurrentSite.preferences.custom['${realmId}'];`,
        ''
    ].join('\n');
}

/**
 * Write the demo code reference file into a cartridge in the sibling repo.
 * @param {string} repoPath - Absolute path to the sibling SFCC repo
 * @param {string} cartridgeName - Target cartridge name
 * @param {string} realmForUsage - Realm whose attribute should appear "used"
 * @returns {string} Absolute path to the created file
 */
export function writeDemoCodeReference(repoPath, cartridgeName, realmForUsage) {
    const cartridgeDir = path.join(
        repoPath, 'cartridges', cartridgeName, 'cartridge', 'scripts'
    );

    if (!fs.existsSync(cartridgeDir)) {
        fs.mkdirSync(cartridgeDir, { recursive: true });
    }

    const filePath = path.join(cartridgeDir, DEMO_CODE_FILENAME);
    const content = buildDemoCodeReference(realmForUsage);

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ${LOG_PREFIX.INFO} Code reference written: ${filePath}`);
    return filePath;
}

// ============================================================================
// SCENARIO STATE PERSISTENCE
// ============================================================================

/**
 * Save the demo scenario state to disk for teardown.
 * @param {Object} state - Scenario state
 * @param {string} state.instanceType - Instance type used
 * @param {string[]} state.realms - Realms processed
 * @param {string} state.repoPath - Sibling repo path
 * @param {string} state.cartridgeName - Cartridge used for code reference
 * @param {string} state.realmForUsage - Realm used for code usage simulation
 * @param {Map<string, string>} state.backupPaths - Realm → backup file paths
 * @param {Object} state.previousWhitelist - Previous whitelist snapshot
 * @param {string} state.metaFilePath - Path to demo meta XML
 * @param {string} state.codeFilePath - Path to demo code reference file
 * @param {string[]} state.attributeIds - Demo attribute IDs
 * @returns {string} Path to saved state file
 */
export function saveScenarioState(state) {
    const stateDir = path.join(process.cwd(), DIRECTORIES.RESULTS);

    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
    }

    const filePath = path.join(stateDir, SCENARIO_STATE_FILE);

    // Convert Map to plain object for JSON serialization
    const serializable = {
        ...state,
        backupPaths: Object.fromEntries(state.backupPaths),
        createdAt: new Date().toISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
    console.log(`  ${LOG_PREFIX.INFO} Scenario state saved: ${filePath}`);
    return filePath;
}

/**
 * Load the demo scenario state from disk.
 * @returns {Object|null} Scenario state or null if not found
 */
export function loadScenarioState() {
    const filePath = path.join(process.cwd(), DIRECTORIES.RESULTS, SCENARIO_STATE_FILE);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const state = JSON.parse(raw);

    // Convert backupPaths back to Map
    state.backupPaths = new Map(Object.entries(state.backupPaths));
    return state;
}

/**
 * Remove the scenario state file from disk.
 */
export function removeScenarioState() {
    const filePath = path.join(process.cwd(), DIRECTORIES.RESULTS, SCENARIO_STATE_FILE);

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`  ${LOG_PREFIX.INFO} Scenario state removed`);
    }
}

// ============================================================================
// TEARDOWN HELPERS
// ============================================================================

/**
 * Delete demo attributes from all recorded realms via OCAPI.
 * @param {Object} state - Loaded scenario state
 * @returns {Promise<{totalDeleted: number, totalFailed: number}>}
 */
export async function deleteDemoAttributes(state) {
    const realmPreferenceMap = new Map();
    for (const realm of state.realms) {
        realmPreferenceMap.set(realm, [...state.attributeIds]);
    }

    return deletePreferencesForRealms({
        realmPreferenceMap,
        objectType: IDENTIFIERS.SITE_PREFERENCES,
        dryRun: false
    });
}

/**
 * Remove demo artifacts (meta XML and code reference) from the sibling repo.
 * @param {Object} state - Loaded scenario state
 * @returns {{ metaRemoved: boolean, codeRemoved: boolean }}
 */
export function removeDemoArtifacts(state) {
    let metaRemoved = false;
    let codeRemoved = false;

    if (state.metaFilePath && fs.existsSync(state.metaFilePath)) {
        fs.unlinkSync(state.metaFilePath);
        console.log(`  ${LOG_PREFIX.INFO} Meta file removed: ${state.metaFilePath}`);
        metaRemoved = true;
    } else {
        console.log(`  ${LOG_PREFIX.WARNING} Meta file not found: ${state.metaFilePath}`);
    }

    if (state.codeFilePath && fs.existsSync(state.codeFilePath)) {
        fs.unlinkSync(state.codeFilePath);
        console.log(`  ${LOG_PREFIX.INFO} Code reference removed: ${state.codeFilePath}`);
        codeRemoved = true;
    } else {
        console.log(`  ${LOG_PREFIX.WARNING} Code reference not found: ${state.codeFilePath}`);
    }

    return { metaRemoved, codeRemoved };
}

/**
 * Clean up generated backup files from the setup.
 * @param {Object} state - Loaded scenario state
 */
export function removeDemoBackups(state) {
    for (const [realm, filePath] of state.backupPaths) {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`  ${LOG_PREFIX.INFO} Backup removed: ${path.basename(filePath)}`);
        }
    }
}
