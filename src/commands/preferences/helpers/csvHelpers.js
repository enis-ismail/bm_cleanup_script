import path from 'path';
import fs from 'fs';

/**
 * Find the latest usage CSV file for a realm
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @returns {string|null} Path to latest usage CSV or null
 */
export function findLatestUsageCsv(realm, instanceType) {
    const realmDir = path.join(process.cwd(), 'results', instanceType, realm);
    if (!fs.existsSync(realmDir)) {
        return null;
    }

    const candidates = fs.readdirSync(realmDir)
        .filter(name => name.endsWith('_preferences_usage.csv'))
        .map(name => path.join(realmDir, name));

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return candidates[0];
}
