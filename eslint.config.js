import js from '@eslint/js';

export default [
    {
        ignores: ['node_modules/**', 'results/**', '.git/**']
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                console: 'readonly',
                process: 'readonly'
            }
        },
        rules: {
            ...js.configs.recommended.rules,
            'indent': ['error', 4],
            'linebreak-style': ['error', 'unix'],
            'quotes': ['error', 'single'],
            'semi': ['error', 'always'],
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'max-len': ['warn', { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreComments: true }],
            'no-console': 'off',
            'object-curly-spacing': ['error', 'always'],
            'array-bracket-spacing': ['error', 'never'],
            'comma-dangle': ['error', 'never'],
            'eol-last': ['error', 'always'],
            'no-trailing-spaces': 'error'
        }
    }
];
