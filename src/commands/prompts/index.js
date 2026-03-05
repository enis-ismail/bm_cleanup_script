import * as realmPrompts from './realmPrompts.js';
import * as preferencePrompts from './preferencePrompts.js';
import * as commonPrompts from './commonPrompts.js';

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
    deletionSourcePrompt,
    deletionLevelPrompt,
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
    repositoryPrompt,
    repositoriesMultiSelectPrompt,
    realmScopePrompt,
    resolveRealmScopeSelection,
    realmsByInstanceTypePrompt,
    getRealmsForInstanceType
} from './commonPrompts.js';

export const prompts = {
    ...realmPrompts,
    ...preferencePrompts,
    ...commonPrompts
};

export default prompts;
