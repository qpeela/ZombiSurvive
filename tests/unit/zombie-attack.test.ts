import type { PlayerMovementState, WorldObstacle, ZombieAttackState } from '@zombi-survive/domain';
import { stepZombieAttack } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const target: PlayerMovementState = {
    playerId: 'player',
    position: { xMeters: 1.1, yMeters: 0 },
    stamina: 1,
    isExhausted: false,
    isSneaking: false,
    noiseRadiusMeters: 0,
};
const zombie = {
    zombieId: 'zombie',
    position: { xMeters: 0, yMeters: 0 },
    targetPlayerId: target.playerId,
};
const idle: ZombieAttackState = { targetPlayerId: null, ticksUntilHit: 0 };
const health = { playerId: target.playerId, health: 100 };
const windup = { targetPlayerId: target.playerId, ticksUntilHit: 1 };
const wall: WorldObstacle = {
    id: 'wall',
    minXMeters: 0.4,
    maxXMeters: 0.6,
    minYMeters: -1,
    maxYMeters: 1,
};

test('the first and repeated hits need 20 consecutive reachable ticks, independent of wall clock', () => {
    let state = { attack: idle, health };

    for (let tick = 1; tick <= 60; tick++) {
        const result = stepZombieAttack({ ...state, zombie, target, obstacles: [] });
        expect(result.health).toBeDefined();
        state = { attack: result.attack, health: result.health ?? health };
        expect(state.health.health).toBe(100 - Math.floor(tick / 20) * 10);
    }

    expect(health.health).toBe(100);
    expect(idle.ticksUntilHit).toBe(0);
});

test.each([
    { target: { ...target, position: { xMeters: 1.10001, yMeters: 0 } }, obstacles: [] },
    { target: { ...target, position: { xMeters: -1.10001, yMeters: 0 } }, obstacles: [] },
    { target, obstacles: [wall] },
    { target: undefined, obstacles: [] },
    { target: { ...target, playerId: 'other' }, obstacles: [] },
])('loss of reach, visibility or connected target cancels the pending hit: %j', input => {
    const result = stepZombieAttack({ ...input, zombie, attack: windup, health });
    expect(result).toEqual({ attack: idle, health });
    const returned = stepZombieAttack({
        zombie,
        target,
        health,
        attack: result.attack,
        obstacles: [],
    });
    expect(returned.health).toEqual(health);
    expect(returned.attack.ticksUntilHit).toBe(19);
});

test('switching target starts a full delay and only affects the matching player', () => {
    const result = stepZombieAttack({
        zombie: { ...zombie, targetPlayerId: 'other' },
        target: { ...target, playerId: 'other' },
        health: { playerId: 'other', health: 100 },
        attack: windup,
        obstacles: [],
    });
    expect(result.health?.health).toBe(100);
    expect(result.attack).toEqual({ targetPlayerId: 'other', ticksUntilHit: 19 });
    expect(
        stepZombieAttack({
            zombie,
            target,
            health: { playerId: 'other', health: 100 },
            attack: windup,
            obstacles: [],
        }).attack,
    ).toEqual(idle);
});

test('damage clamps to zero and zero health receives no further hits or windup', () => {
    const result = stepZombieAttack({
        zombie,
        target,
        health: { ...health, health: 3 },
        attack: windup,
        obstacles: [],
    });
    expect(result.health?.health).toBe(0);
    const next = stepZombieAttack({ ...result, zombie, target, obstacles: [] });
    expect(next.health?.health).toBe(0);
    expect(next.attack).toEqual(idle);
});
