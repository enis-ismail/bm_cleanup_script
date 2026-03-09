/**
 * Prompts for debug/test commands.
 * Used by get-attribute-group and other debug commands in debug.js.
 *
 * @module debugPrompts
 */

/**
 * Input an attribute group ID.
 * @returns {Object[]} Inquirer prompt config — answer key: `groupId`
 */
export const groupIdPrompt = () => ([{
    name: 'groupId',
    type: 'input',
    message: 'Attribute Group ID?',
    validate: (input) => input && input.trim().length > 0 ? true : 'Group ID is required'
}]);
