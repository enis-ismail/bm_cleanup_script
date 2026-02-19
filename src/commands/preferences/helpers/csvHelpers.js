import path from 'path';
import fs from 'fs';
import { DIRECTORIES, FILE_PATTERNS } from '../../../config/constants.js';

/**
 * Find the latest usage CSV file for a realm
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @returns {string|null} Path to latest usage CSV or null
 */
export function findLatestUsageCsv(realm, instanceType) {
    const realmDir = path.join(process.cwd(), DIRECTORIES.RESULTS, instanceType, realm);
    if (!fs.existsSync(realmDir)) {
        return null;
    }

    const candidates = fs.readdirSync(realmDir)
        .filter(name => name.endsWith(FILE_PATTERNS.PREFERENCES_USAGE))
        .map(name => path.join(realmDir, name));

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return candidates[0];
}
