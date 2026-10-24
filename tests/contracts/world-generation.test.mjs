import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { generateWorldChunk, loadWorldChunks } from '@zombi-survive/worldgen';

const key = { seed: 'cross-runtime:мир', generatorVersion: 1, chunkX: -7, chunkY: 3 };

test('built and development APIs generate byte-identical versioned world geometry', () => {
    assert.ok(import.meta.resolve('@zombi-survive/worldgen').endsWith('/dist/index.js'));
    const chunk = JSON.stringify(generateWorldChunk(key));
    const result = spawnSync(
        process.execPath,
        [
            '--conditions=development',
            '--input-type=module',
            '-e',
            `
        import assert from 'node:assert/strict';
        import { generateWorldChunk } from '@zombi-survive/worldgen';
        assert.ok(import.meta.resolve('@zombi-survive/worldgen').endsWith('/src/index.ts'));
        process.stdout.write(JSON.stringify(generateWorldChunk(${JSON.stringify(key)})));
    `,
        ],
        { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, chunk);
    // Changing v1 geometry requires a new version, not silently replacing explored terrain.
    assert.equal(
        createHash('sha256').update(chunk).digest('hex'),
        'd501ca5f30bbe33b8a82eb9804643632cb6df188dcbf25dad55143b0e7b87f69',
    );
});

test('built and development chunk windows agree after unloading and revisiting signed coordinates', () => {
    const positions = [
        { xMeters: -96, yMeters: 32 },
        { xMeters: 320, yMeters: -320 },
        { xMeters: -96, yMeters: 32 },
    ];
    let chunks = [];
    for (const position of positions)
        chunks = loadWorldChunks({ positions: [position], previousChunks: chunks });
    const result = spawnSync(
        process.execPath,
        [
            '--conditions=development',
            '--input-type=module',
            '-e',
            `
        import { loadWorldChunks } from '@zombi-survive/worldgen';
        let chunks = [];
        for (const position of ${JSON.stringify(positions)}) chunks = loadWorldChunks({ positions: [position], previousChunks: chunks });
        process.stdout.write(JSON.stringify(chunks));
    `,
        ],
        { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify(chunks));
});
