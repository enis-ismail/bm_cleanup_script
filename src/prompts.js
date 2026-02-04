import { getAvailableRealms, getInstanceType, getRealmsByInstanceType } from './helpers.js';

export const realmPrompt = () => ([
    {
        name: 'realm',
        message: 'Choose a realm?',
        type: 'rawlist',
        choices: getAvailableRealms(),
        default: getAvailableRealms()[0]
    }
]);

export const realmWithAllPrompt = () => ([
    {
        name: 'realm',
        message: 'Choose a realm?',
        type: 'rawlist',
        choices: ['all realms', ...getAvailableRealms()],
        default: 'all realms'
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
    },
    {
        name: 'siteTemplatesPath',
        message: 'Site templates path (e.g., sites/site_template_bcwr080) [Optional]:',
        default: ''
    },
    {
        name: 'instanceType',
        message: 'Instance type?',
        type: 'rawlist',
        choices: ['sandbox', 'development', 'staging', 'production'],
        default: 'sandbox'
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
        default: true
    }
]);

export const preferenceIdPrompt = () => ([
    {
        name: 'preferenceId',
        message: 'Preference ID to search for?',
        validate: (input) => input && input.trim().length > 0 ? true : 'Preference ID is required'
    }
]);

export const realmScopePrompt = () => ([
    {
        name: 'realmScope',
        message: 'Choose realm selection method:',
        type: 'rawlist',
        choices: ['Single realm', 'All realms', 'All realms of an instance type'],
        default: 'All realms'
    }
]);

export const resolveRealmScopeSelection = async (promptFn) => {
    const realmScopeAnswers = await promptFn(realmScopePrompt());
    let realmList;
    let instanceTypeOverride;

    if (realmScopeAnswers.realmScope === 'Single realm') {
        const realmAnswers = await promptFn(realmPrompt());
        realmList = [realmAnswers.realm];
        instanceTypeOverride = getInstanceType(realmAnswers.realm);
    } else if (realmScopeAnswers.realmScope === 'All realms of an instance type') {
        const instanceAnswers = await promptFn(realmsByInstanceTypePrompt());
        realmList = getRealmsForInstanceType(instanceAnswers.instanceType);
        instanceTypeOverride = instanceAnswers.instanceType;
    } else {
        realmList = getAvailableRealms();
        instanceTypeOverride = null;
    }

    return { realmList, instanceTypeOverride };
};

export const realmsByInstanceTypePrompt = () => ([
    {
        name: 'instanceType',
        message: 'Select instance type to process all realms:',
        type: 'rawlist',
        choices: ['sandbox', 'development', 'staging', 'production'],
        default: 'development'
    }
]);

export const getRealmsForInstanceType = (instanceType) => {
    const realms = getRealmsByInstanceType(instanceType);
    if (realms.length === 0) {
        return null;
    }
    return realms;
};
