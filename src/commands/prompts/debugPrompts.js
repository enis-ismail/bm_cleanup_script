export const repositoryPrompt = async (siblings) => ([
    {
        type: 'rawlist',
        name: 'repository',
        message: 'Select repository to validate cartridges for:',
        choices: siblings
    }
]);
