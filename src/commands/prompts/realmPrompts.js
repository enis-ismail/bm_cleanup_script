import { getAvailableRealms, getRealmsByInstanceType } from '../../index.js';

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

export const instanceTypePrompt = (defaultValue = 'sandbox') => ([
    {
        name: 'instanceType',
        message: 'Instance type (staging, development, sandbox, production)?',
        type: 'rawlist',
        choices: ['staging', 'development', 'sandbox', 'production'],
        default: defaultValue
    }
]);

export const realmByInstanceTypePrompt = (instanceType) => {
    const realms = getRealmsByInstanceType(instanceType);
    return [
        {
            name: 'realm',
            message: 'Select a realm for backup:',
            type: 'rawlist',
            choices: realms,
            default: realms[0]
        }
    ];
};
