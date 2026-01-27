import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Derive realm name from hostname
 */
export function deriveRealm(hostname) {
    return String(hostname || '').split('.')[0] || 'realm';
}

/**
 * Add a new realm to config.json
 */
export function addRealmToConfig(name, hostname, clientId, clientSecret) {
    try {
        const configPath = path.resolve(__dirname, '../config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        
        // Check if realm already exists
        if (config.realms.some(r => r.name === name)) {
            console.error(`Realm '${name}' already exists in config.json`);
            return false;
        }
        
        // Add new realm
        config.realms.push({
            name,
            hostname,
            clientId,
            clientSecret
        });
        
        // Write back to file
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`Realm '${name}' added to config.json`);
        return true;
    } catch (error) {
        console.error('Error adding realm to config:', error.message);
        return false;
    }
}

/**
 * Remove a realm from config.json with confirmation
 */
export async function removeRealmFromConfig(realmName) {
    try {
        const configPath = path.resolve(__dirname, '../config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        
        // Check if realm exists
        const realmExists = config.realms.some(r => r.name === realmName);
        if (!realmExists) {
            console.error(`Realm '${realmName}' not found in config.json`);
            return false;
        }
        
        // Remove realm
        config.realms = config.realms.filter(r => r.name !== realmName);
        
        // Write back to file
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`Realm '${realmName}' removed from config.json`);
        return true;
    } catch (error) {
        console.error('Error removing realm from config:', error.message);
        return false;
    }
}

// Ensure a realm directory exists and return its path
export function ensureRealmDir(realm) {
    const dir = path.resolve(__dirname, '..', realm);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
