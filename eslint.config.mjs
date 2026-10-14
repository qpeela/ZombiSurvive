import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'];
const coreFiles = ['packages/*/src/**/*.ts'];

export default defineConfig([
    { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.cache/**'] },
    {
        files: ['**/*.{js,mjs,cjs,ts,tsx}'],
        extends: [js.configs.recommended],
        plugins: { 'simple-import-sort': simpleImportSort },
        linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: {
            'simple-import-sort/imports': 'error',
            'simple-import-sort/exports': 'error',
            'no-nested-ternary': 'error',
            'object-shorthand': 'error',
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'UnaryExpression[operator="!"][argument.operator="!"]',
                    message: 'Use Boolean(value) for an explicit boolean conversion.',
                },
            ],
        },
    },
    {
        files: ['**/*.{mjs,cjs}', 'tools/**/*.ts', 'apps/server/**/*.ts'],
        languageOptions: { globals: globals.node },
    },
    {
        files: [...sourceFiles, 'tools/**/*.ts', 'tests/unit/**/*.ts'],
        extends: [tseslint.configs.strictTypeChecked],
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/strict-boolean-expressions': [
                'error',
                { allowNumber: false, allowString: false },
            ],
        },
    },
    {
        files: ['apps/client/**/*.{ts,tsx}'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: sourceFiles,
        rules: {
            'no-console': 'error',
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        { group: ['@zombi-survive/*/*'], message: 'Use package public API.' },
                    ],
                },
            ],
        },
    },
    {
        files: coreFiles,
        rules: {
            'no-restricted-globals': [
                'error',
                'Date',
                'performance',
                'window',
                'document',
                'process',
                'setTimeout',
                'setInterval',
                'requestAnimationFrame',
                'fetch',
            ],
            'no-restricted-properties': [
                'error',
                { object: 'Math', property: 'random', message: 'Inject seeded RNG.' },
                { object: 'Date', property: 'now', message: 'Inject time through step context.' },
            ],
        },
    },
    prettier,
]);
