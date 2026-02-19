// Re-export all prompts for convenience
export {
    realmPrompt,
    realmWithAllPrompt,
    addRealmPrompts,
    selectRealmToRemovePrompt,
    confirmRealmRemovalPrompt,
    instanceTypePrompt,
    realmByInstanceTypePrompt
} from './realmPrompts.js';

export {
    objectTypePrompt,
    scopePrompts,
    includeDefaultsPrompt,
    preferenceIdPrompt,
    confirmPreferenceDeletionPrompt,
    runAnalyzePreferencesPrompt,
    useExistingBackupPrompt,
    useExistingBackupsForAllRealmsPrompt
} from './preferencePrompts.js';

export {
    repositoryPrompt
} from './debugPrompts.js';

export {
    realmScopePrompt,
    resolveRealmScopeSelection,
    realmsByInstanceTypePrompt,
    getRealmsForInstanceType
} from './commonPrompts.js';
