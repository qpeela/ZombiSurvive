import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scenario = `
import assert from 'node:assert/strict';
import { combatSettings } from '@zombi-survive/content';
import { isHealthSnapshot, healthVersion, protocolVersion, isMeleeCommand, isMeleeSnapshot, meleeVersion } from '@zombi-survive/protocol';
import { stepZombieAttack, findMeleeTarget } from '@zombi-survive/simulation';
const target = {
    playerId: 'player', position: { xMeters: 0.9, yMeters: 0 },
    stamina: 1, isExhausted: false, isSneaking: false, noiseRadiusMeters: 0,
};
const zombie = { zombieId: 'zombie', position: { xMeters: 0, yMeters: 0 }, targetPlayerId: 'player' };
let state = { attack: { targetPlayerId: null, ticksUntilHit: 0 }, health: { playerId: 'player', health: 100 } };
for (let tick = 0; tick < combatSettings.attackIntervalTicks; tick++) {
    state = stepZombieAttack({ ...state, zombie, target, obstacles: [] });
}
assert.equal(state.health.health, 90);
const snapshot = {
    type: 'health-state', protocolVersion, healthVersion, worldId: 'world', tick: 20,
    ...state.health, maxHealth: combatSettings.maxHealth,
};
assert.ok(isHealthSnapshot(JSON.parse(JSON.stringify(snapshot))));
assert.equal(findMeleeTarget({ position: target.position, zombies: [zombie], obstacles: [] }), zombie);
assert.ok(isMeleeCommand({ type: 'melee-attack', protocolVersion, meleeVersion }));
assert.ok(isMeleeSnapshot({ type: 'melee-state', protocolVersion, meleeVersion, worldId: 'world', playerId: 'player', tick: 1, weapon: 'club' }));
`;
for (const mode of ['built', 'development']) {
    test(`combat public APIs work together in ${mode} mode`, () => {
        const result = spawnSync(
            process.execPath,
            [
                ...(mode === 'development' ? ['--conditions=development'] : []),
                '--input-type=module',
                '-e',
                scenario,
            ],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stderr);
    });
}
