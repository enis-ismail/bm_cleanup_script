/**
 * Validate realm selection and return list to process
 * @param {Array<string>} realmsToProcess - List of realms from selection
 * @returns {boolean} True if realms are valid, false otherwise
 */
export function validateRealmsSelection(realmsToProcess) {
    if (!realmsToProcess || realmsToProcess.length === 0) {
        console.log('No realms found for the selected scope.');
        return false;
    }
    return true;
}
