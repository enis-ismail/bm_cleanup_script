import { getAvailableRealms } from './helpers.js';

export const realmPrompt = () => ([
    {
        name: 'realm',
        message: 'Choose a realm?',
        type: 'rawlist',
        choices: getAvailableRealms(),
        default: getAvailableRealms()[0]
    }
]);

export const objectTypePrompt = (defaultValue = 'SitePreferences') => ([
    {
        name: 'objectType',
        message: 'Choose an object type?',
        type: 'rawlist',
        choices: ['SitePreferences'],
        default: defaultValue
    }
]);

export const instanceTypePrompt = (defaultValue = 'sandbox') => ([
    {
        name: 'instanceType',
        message: 'Instance type (staging, development, sandbox, production)?',
        type: 'rawlist',
        choices: ['staging', 'development', 'sandbox', 'production'],
        default: defaultValue
    }
]);

export const addRealmPrompts = () => ([
    {
        name: 'name',
        message: 'Realm name (e.g., bcwr-080)?',
        validate: (input) => input.length > 0 || 'Realm name is required'
    },
    {
        name: 'hostname',
        message: 'Sandbox hostname (e.g., bcwr-080.dx.commercecloud.salesforce.com)?',
        validate: (input) => input.length > 0 || 'Hostname is required'
    },
    {
        name: 'clientId',
        message: 'Client ID?',
        validate: (input) => input.length > 0 || 'Client ID is required'
    },
    {
        name: 'clientSecret',
        message: 'Client Secret?',
        validate: (input) => input.length > 0 || 'Client Secret is required'
    }
]);

export const selectRealmToRemovePrompt = (realms) => ([
    {
        name: 'realmToRemove',
        message: 'Choose a realm to remove:',
        type: 'rawlist',
        choices: realms
    }
]);

export const confirmRealmRemovalPrompt = (realmName) => ([
    {
        name: 'confirm',
        message: `Are you sure you want to remove realm '${realmName}'? This cannot be undone.`,
        type: 'confirm',
        default: false
    }
]);

export const scopePrompts = () => ([
    {
        name: 'scope',
        message: 'Run for all sites or single site?',
        type: 'rawlist',
        choices: ['all', 'single'],
        default: 'all'
    },
    {
        name: 'siteId',
        message: 'Enter site ID to process',
        when: (a) => a.scope === 'single',
        validate: (input) => input && input.trim().length > 0 ? true : 'Site ID is required'
    }
]);

export const repositoryPrompt = async (siblings) => ([
    {
        type: 'rawlist',
        name: 'repository',
        message: 'Select repository to validate cartridges for:',
        choices: siblings
    }
]);

export const includeDefaultsPrompt = () => ([
    {
        type: 'confirm',
        name: 'includeDefaults',
        message: 'Include default values? (slower)',
        default: false
    }
]);
