import { getAvailableRealms, getInstanceType, getRealmsByInstanceType } from '../../index.js';

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
        const { realmPrompt } = await import('./realmPrompts.js');
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
