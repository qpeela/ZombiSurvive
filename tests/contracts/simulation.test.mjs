import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { movementSettings } from '@zombi-survive/content';
import { movementStepSeconds, stepPlayerMovement } from '@zombi-survive/simulation';

test('movement packages expose working built and development public APIs to Node', () => {
    for (const name of ['content', 'simulation']) {
        assert.ok(import.meta.resolve(`@zombi-survive/${name}`).endsWith('/dist/index.js'));
    }

    assert.ok(Object.isFrozen(movementSettings));
    assert.deepEqual(
        stepPlayerMovement(
            {
                playerId: 'player-1',
                stamina: 1,
                isExhausted: false,
                isSneaking: false,
                noiseRadiusMeters: 0,
                position: { xMeters: 0, yMeters: 0 },
            },
            { x: 1, y: 0 },
            movementStepSeconds,
        ),
        {
            playerId: 'player-1',
            stamina: 1,
            isExhausted: false,
            isSneaking: false,
            noiseRadiusMeters: 8,
            position: { xMeters: 0.2, yMeters: 0 },
        },
    );

    const result = spawnSync(
        process.execPath,
        [
            '--conditions=development',
            '--input-type=module',
            '-e',
            `import assert from 'node:assert/strict';
         import { movementSettings } from '@zombi-survive/content';
         import { movementStepSeconds, stepPlayerMovement } from '@zombi-survive/simulation';
         for (const name of ['content', 'simulation']) {
             assert.ok(import.meta.resolve('@zombi-survive/' + name).endsWith('/src/index.ts'));
         }
         assert.ok(Object.isFrozen(movementSettings));
         assert.deepEqual(stepPlayerMovement(
             { playerId: 'player-1', stamina: 1, isExhausted: false, isSneaking: false, noiseRadiusMeters: 0, position: { xMeters: 0, yMeters: 0 } },
             { x: -1, y: 0 }, movementStepSeconds,
         ), { playerId: 'player-1', stamina: 1, isExhausted: false, isSneaking: false, noiseRadiusMeters: 8, position: { xMeters: -0.2, yMeters: 0 } });`,
        ],
        { encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
});
