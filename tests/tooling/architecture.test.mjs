import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const executable = resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const configuration = resolve('.dependency-cruiser.mjs');

const inspectGraph = files => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-architecture-'));

    try {
        mkdirSync(join(directory, 'apps'), { recursive: true });
        mkdirSync(join(directory, 'packages'), { recursive: true });
        writeFileSync(join(directory, 'tsconfig.json'), '{"compilerOptions":{"target":"ES2022"}}');

        for (const [name, code] of Object.entries(files)) {
            const file = join(directory, name);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, code);
        }

        const result = spawnSync(
            process.execPath,
            [executable, '--config', configuration, '--output-type', 'json', 'apps', 'packages'],
            { cwd: directory, encoding: 'utf8' },
        );
        assert.ok(result.stdout, result.stderr);
        const report = JSON.parse(result.stdout);

        return report.summary.violations.map(violation => violation.rule.name);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
};

test('simulation may depend on the domain public API', () => {
    const violations = inspectGraph({
        'packages/domain/src/index.ts': 'export const speed = 1;',
        'packages/simulation/src/index.ts':
            "import { speed } from '../../domain/src/index.ts'; export const value = speed;",
    });
    assert.deepEqual(violations, []);
});

test('client cannot import server even through a relative path', () => {
    const violations = inspectGraph({
        'apps/server/src/index.ts': 'export const secret = 1;',
        'apps/client/src/index.ts':
            "import { secret } from '../../server/src/index.ts'; export const value = secret;",
    });
    assert.ok(violations.includes('dependencies-of-apps-client'));
});

test('domain cannot import a higher layer through a type-only import', () => {
    const violations = inspectGraph({
        'packages/protocol/src/index.ts': 'export type Message = { value: number };',
        'packages/domain/src/index.ts':
            "import type { Message } from '../../protocol/src/index.ts'; export type Value = Message;",
    });
    assert.ok(violations.includes('dependencies-of-packages-domain'));
});

test('cross-package access to an internal module is rejected', () => {
    const violations = inspectGraph({
        'packages/domain/src/internal.ts': 'export const speed = 1;',
        'packages/simulation/src/index.ts':
            "import { speed } from '../../domain/src/internal.ts'; export const value = speed;",
    });
    assert.ok(violations.includes('package-public-api-only'));
});

test('direct imports inside a package remain allowed', () => {
    const violations = inspectGraph({
        'packages/domain/src/internal.ts': 'export const speed = 1;',
        'packages/domain/src/index.ts': "export { speed } from './internal.ts';",
    });
    assert.deepEqual(violations, []);
});

test('cycles inside a package are rejected', () => {
    const violations = inspectGraph({
        'packages/domain/src/index.ts': "import './internal.ts'; export const speed = 1;",
        'packages/domain/src/internal.ts': "import './index.ts'; export const value = 2;",
    });
    assert.ok(violations.includes('no-circular-dependencies'));
});

test('core packages cannot depend on Node runtime APIs', () => {
    const violations = inspectGraph({
        'packages/simulation/src/index.ts':
            "import { readFile } from 'node:fs'; export { readFile };",
    });
    assert.ok(violations.includes('core-without-runtime-dependencies'));
});

test('unresolved imports fail the architecture check', () => {
    const violations = inspectGraph({
        'packages/domain/src/index.ts': "import './missing.ts'; export const speed = 1;",
    });
    assert.ok(violations.includes('no-unresolved-imports'));
});

test('new layers must be explicitly declared even when they have no imports', () => {
    const violations = inspectGraph({
        'packages/rogue/src/index.ts': 'export const value = 1;',
    });
    assert.ok(violations.includes('no-undeclared-orphan-layers'));
});

test('browser code cannot import Node runtime APIs', () => {
    const violations = inspectGraph({
        'apps/client/src/index.ts': "import { readFile } from 'node:fs'; export { readFile };",
    });
    assert.ok(violations.includes('no-node-runtime-in-client'));
});

test('game code cannot import test fixtures', () => {
    const violations = inspectGraph({
        'tests/fixture.ts': 'export const value = 1;',
        'apps/client/src/index.ts':
            "import { value } from '../../../tests/fixture.ts'; export { value };",
    });
    assert.ok(violations.includes('no-game-to-tooling'));
});
