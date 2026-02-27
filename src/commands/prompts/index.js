// Re-export all prompts for convenience
export {
    realmPrompt,
    realmWithAllPrompt,
    addRealmPrompts,
    selectRealmToRemovePrompt,
    confirmRealmRemovalPrompt,
    instanceTypePrompt,
    realmByInstanceTypePrompt,
    selectRealmsForInstancePrompt
} from './realmPrompts.js';

export {
    preferenceIdPrompt,
    confirmPreferenceDeletionPrompt,
    runAnalyzePreferencesPrompt,
    confirmRestoreAfterDeletionPrompt,
    confirmProceedRestorePrompt,
    overwriteBackupsPrompt,
    refreshMetadataPrompt,
    applyBackupCorrectionsPrompt,
    useExistingBackupPrompt,
    useExistingBackupsForAllRealmsPrompt,
    promptBackupCachePreference,
    objectTypePrompt,
    scopePrompts,
    includeDefaultsPrompt
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
