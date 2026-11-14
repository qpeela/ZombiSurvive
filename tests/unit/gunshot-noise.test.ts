import { initialZombie, pistolSettings, zombieSettings } from '@zombi-survive/content';
import type { PlayerMovementState, WorldObstacle, ZombieState } from '@zombi-survive/domain';
import { firearmVersion, protocolVersion, type ShotAction } from '@zombi-survive/protocol';
import {
    hearGunshot,
    movementStepSeconds,
    resolveMovement,
    stepGunshotInvestigation,
    stepZombie,
} from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldZombie } from '../../apps/server/src/local-world-zombie.ts';

const origin = { xMeters: 0, yMeters: 0 };
const player = (x: number): PlayerMovementState => ({
    playerId: 'solo',
    position: { xMeters: x, yMeters: 0 },
    stamina: 1,
    isExhausted: false,
    isSneaking: false,
    noiseRadiusMeters: 0,
});
const idle: ZombieState = { zombieId: 'z', position: origin, targetPlayerId: null };
const event = (tick = 1, revision = 1, x = 0): ShotAction => ({
    type: 'shot-action',
    protocolVersion,
    firearmVersion,
    worldId: 'world',
    playerId: 'solo',
    tick,
    itemId: 'pistol-v1:0:0',
    weaponRevision: revision,
    origin: { xMeters: x, yMeters: 0 },
    impact: { outcome: 'miss', position: { xMeters: x + 20, yMeters: 0 } },
});

test('ordinary sight is 6m and pursuit 12m, with exact inclusive boundaries and no visibility shrink', () => {
    expect(zombieSettings).toMatchObject({
        sightRangeMeters: 6,
        pursuitRangeMeters: 12,
        visibilityRangeMeters: 22,
    });
    const step = (zombie: ZombieState, x: number, obstacles: readonly WorldObstacle[] = []) =>
        stepZombie({ zombie, players: [player(x)], obstacles, stepSeconds: movementStepSeconds });
    expect(step(idle, 6).targetPlayerId).toBe('solo');
    expect(step(idle, 6.001).targetPlayerId).toBeNull();
    expect(step({ ...idle, targetPlayerId: 'solo' }, 12).targetPlayerId).toBe('solo');
    expect(step({ ...idle, targetPlayerId: 'solo' }, 12.001).targetPlayerId).toBeNull();
    expect(
        step(idle, 5, [{ id: 'wall', minXMeters: 2, maxXMeters: 3, minYMeters: -2, maxYMeters: 2 }])
            .targetPlayerId,
    ).toBeNull();
});
test('hearing includes the radius boundary and expires at the event deadline, never receipt time', () => {
    expect(
        hearGunshot({ position: { xMeters: 24, yMeters: 0 }, origin, shotTick: 5, tick: 10 }),
    ).toEqual({ position: origin, expiresAtTick: 205 });
    expect(
        hearGunshot({ position: { xMeters: 24.001, yMeters: 0 }, origin, shotTick: 5, tick: 10 }),
    ).toBeNull();
    expect(hearGunshot({ position: origin, origin, shotTick: 5, tick: 205 })).toBeNull();
    expect(hearGunshot({ position: origin, origin, shotTick: 5, tick: 4 })).toBeNull();
});
test('investigation routes around a wall without clipping or impersonating a player, then stops/ages out', () => {
    const wall = { id: 'wall', minXMeters: -1, maxXMeters: 0, minYMeters: -3, maxYMeters: 3 };
    const heard = { position: { xMeters: 3, yMeters: 0 }, expiresAtTick: 1000 };
    let zombie: ZombieState = { ...idle, position: { xMeters: -4, yMeters: 0 } };
    for (let tick = 0; tick < 220; tick++) {
        const next = stepGunshotInvestigation({
            zombie,
            heard,
            tick,
            obstacles: [wall],
            stepSeconds: movementStepSeconds,
        });
        expect(next.targetPlayerId).toBeNull();
        expect(resolveMovement(zombie.position, next.position, [wall])).toEqual(next.position);
        expect(
            Math.hypot(
                next.position.xMeters - zombie.position.xMeters,
                next.position.yMeters - zombie.position.yMeters,
            ),
        ).toBeLessThanOrEqual(0.07500001);
        zombie = next;
    }
    expect(Math.hypot(zombie.position.xMeters - 3, zombie.position.yMeters)).toBeCloseTo(
        zombieSettings.stopRangeMeters,
        8,
    );
    expect(
        stepGunshotInvestigation({
            zombie,
            heard,
            tick: 1000,
            obstacles: [],
            stepSeconds: movementStepSeconds,
        }).position,
    ).toEqual(zombie.position);
    expect(() =>
        stepGunshotInvestigation({ zombie, heard, tick: 1, obstacles: [], stepSeconds: 0.1 }),
    ).toThrow(RangeError);
});
const setup = () => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    const zombies = new LocalWorldZombie();
    const step = (position = origin, isAlive = true) => {
        movement.step();
        const snapshot = movement.snapshot('first');
        const placed = { ...snapshot, player: { ...snapshot.player, position } };
        zombies.step(new Map([['first', placed]]), () => isAlive);
        return placed;
    };
    const read = (id = initialZombie.zombieId) =>
        zombies.shotTargets().find(zombie => zombie.zombieId === id);
    return { movement, zombies, step, read };
};
test('a zombie outside 6m remains idle until a gunshot, investigates, then acquires the actual visible player', () => {
    const state = setup();
    state.step();
    expect(state.read()).toEqual(initialZombie);
    state.zombies.hearShot(event());
    state.step();
    expect(state.read()?.position.xMeters).toBeCloseTo(-7.925);
    expect(state.read()?.targetPlayerId).toBeNull();
    for (let tick = 0; tick < 40; tick++) state.step();
    expect(state.read()?.targetPlayerId).toBe('solo');
});
test('radius24 includes a loaded boundary zombie and excludes a farther diagonal spawn', () => {
    const state = setup();
    state.step();
    state.zombies.hearShot(event());
    state.step();
    expect(state.read('slow:0,0:24,0')?.position.xMeters).toBeCloseTo(23.925);
    expect(state.read('slow:0,0:24,24')?.position).toEqual({ xMeters: 24, yMeters: 24 });
});
test('replayed events cannot renew interest; new accepted revisions can investigate a different point', () => {
    const state = setup();
    state.step(origin, false);
    state.zombies.hearShot(event(1, 1, 8));
    for (let tick = 2; tick <= pistolSettings.noiseInterestTicks + 1; tick++) {
        state.zombies.hearShot(event(1, 1, 8));
        state.step(origin, false);
    }
    const stopped = state.read()?.position;
    for (let count = 0; count < 10; count++) {
        state.zombies.hearShot(event(1, 1, 8));
        state.step(origin, false);
    }
    expect(state.read()?.position).toEqual(stopped);
    const currentTick = state.movement.snapshot('first').tick;
    state.zombies.hearShot(event(currentTick, 2, -8));
    state.step(origin, false);
    expect(state.read()?.position.xMeters).toBeLessThan(stopped?.xMeters ?? -100);
});
test('chunk unloading drops investigation and replay after returning cannot revive it', () => {
    const state = setup();
    state.step();
    state.zombies.hearShot(event());
    state.step();
    const before = state.read()?.position;
    state.step({ xMeters: 1000, yMeters: 1000 });
    state.zombies.hearShot(event());
    state.step();
    expect(state.read()?.position).toEqual(before);
    state.zombies.hearShot(event(4, 2));
    state.step();
    expect(state.read()?.position.xMeters).toBeGreaterThan(before?.xMeters ?? 0);
});
test('dead/disconnected targets are released while rendered zombies still include the 18–22m region', () => {
    const state = setup();
    const near = { xMeters: -3, yMeters: 0 };
    state.step(near);
    expect(state.read()?.targetPlayerId).toBe('solo');
    const before = state.read()?.position;
    state.step(near, false);
    expect(state.read()?.targetPlayerId).toBeNull();
    expect(state.read()?.position).toEqual(before);
    const view = state.step({ xMeters: 4, yMeters: 0 });
    expect(
        state.zombies.snapshot(view).zombies.some(zombie => zombie.zombieId === 'slow:0,0:24,0'),
    ).toBe(true);
    state.zombies.step(new Map());
    expect(state.read()?.targetPlayerId).toBeNull();
});
