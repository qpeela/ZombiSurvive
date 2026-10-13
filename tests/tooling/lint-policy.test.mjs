import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

const syntaxLint = new ESLint({
    overrideConfigFile: resolve('eslint.config.mjs'),
    overrideConfig: [tseslint.configs.disableTypeChecked],
});

const checkRule = async (code, rule) => {
    const results = await syntaxLint.lintText(code, {
        filePath: resolve('packages/simulation/src/lint-probe.ts'),
    });
    assert.ok(
        results[0].messages.some(message => message.ruleId === rule),
        JSON.stringify(results[0].messages),
    );
};

test('simulation must receive time explicitly', async () => {
    await checkRule('export const time = Date.now();', 'no-restricted-properties');
});

test('simulation must receive randomness explicitly', async () => {
    await checkRule('export const value = Math.random();', 'no-restricted-properties');
});

test('simulation cannot schedule its own wall-clock timers', async () => {
    await checkRule('setTimeout(() => {}, 100);', 'no-restricted-globals');
});

test('nested ternaries are rejected', async () => {
    await checkRule('export const value = true ? 1 : false ? 2 : 3;', 'no-nested-ternary');
});

test('deep workspace imports are rejected', async () => {
    await checkRule("import '@zombi-survive/domain/src/internal';", 'no-restricted-imports');
});

test('type-aware lint rejects an unhandled promise', async () => {
    const eslint = new ESLint({ overrideConfigFile: resolve('eslint.config.mjs') });
    const results = await eslint.lintText('Promise.resolve(1);', {
        filePath: resolve('tools/architecture-policy.ts'),
    });
    assert.ok(
        results[0].messages.some(
            message => message.ruleId === '@typescript-eslint/no-floating-promises',
        ),
        JSON.stringify(results[0].messages),
    );
});
