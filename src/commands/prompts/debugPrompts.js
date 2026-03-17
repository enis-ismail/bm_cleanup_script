/**
 * Prompts for debug/test commands.
 * Used by get-attribute-group and other debug commands in debug.js.
 *
 * @module debugPrompts
 */

/**
 * Select an attribute group ID from available groups.
 * @param {string[]} groupIds - Available group IDs to choose from
 * @returns {Object[]} Inquirer prompt config — answer key: `groupId`
 */
export const groupIdPrompt = (groupIds = []) => ([{
    name: 'groupId',
    type: 'list',
    message: 'Select Attribute Group:',
    choices: groupIds
}]);
