import { initialZombie, meleeWeapons } from '@zombi-survive/content';
import { isZombieSnapshot } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldZombie } from '../../apps/server/src/local-world-zombie.ts';

test('one world step updates one zombie regardless of tabs; no connections pauses and releases the target', () => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    movement.join('tab');
    const zombie = new LocalWorldZombie();
    const before = zombie.snapshot(movement.snapshot('first'));
    expect(before.zombies).toEqual([initialZombie]);
    movement.step();
    zombie.step(new Map(['first', 'tab'].map(id => [id, movement.snapshot(id)])));
    const state = zombie.snapshot(movement.snapshot('first'));
    expect(isZombieSnapshot(state)).toBe(true);
    expect(state.tick).toBe(1);
    expect(state.zombies[0]?.position.xMeters).toBeCloseTo(-7.925);
    expect(state.zombies[0]?.targetPlayerId).toBe('solo');
    expect(zombie.snapshot(movement.snapshot('tab'))).toEqual(state);
    Object.assign(state.zombies[0]?.position ?? {}, { xMeters: 999 });
    expect(zombie.snapshot(movement.snapshot('first')).zombies[0]?.position.xMeters).toBeCloseTo(
        -7.925,
    );
    movement.leave('first');
    movement.leave('tab');
    for (let tick = 0; tick < 100; tick++) zombie.step(new Map());
    movement.join('rejoined');
    const paused = zombie.snapshot(movement.snapshot('rejoined'));
    expect(paused.zombies[0]?.position.xMeters).toBeCloseTo(-7.925);
    expect(paused.zombies[0]?.targetPlayerId).toBeNull();
    zombie.step(new Map([['rejoined', movement.snapshot('rejoined')]]));
    expect(zombie.snapshot(movement.snapshot('rejoined')).zombies[0]?.targetPlayerId).toBe('solo');
});

test('far-away saved players encounter local zombies instead of the starting zombie', () => {
    const movement = new LocalWorldMovement('world', 'solo', { xMeters: 1000, yMeters: -1000 });
    movement.join('session');
    const zombie = new LocalWorldZombie();
    zombie.step(new Map([['session', movement.snapshot('session')]]));
    const nearby = zombie.snapshot(movement.snapshot('session')).zombies;
    expect(nearby.length).toBeGreaterThan(0);
    expect(nearby.some(state => state.zombieId === initialZombie.zombieId)).toBe(false);
});

test('every visited chunk has nine stable safe spawns, including negative coordinates', () => {
    for (const [chunkX, chunkY] of [
        [0, 0],
        [1, -1],
        [-2, 3],
        [15, -16],
    ]) {
        const x = (chunkX ?? 0) * 64;
        const y = (chunkY ?? 0) * 64;
        const movement = new LocalWorldMovement('world', 'solo', { xMeters: x, yMeters: y });
        movement.join('session');
        const zombies = new LocalWorldZombie();
        const seen = new Map();
        for (const dx of [-24, 0, 24]) {
            for (const dy of [-24, 0, 24]) {
                const snapshot = movement.snapshot('session');
                const placed = {
                    ...snapshot,
                    player: { ...snapshot.player, position: { xMeters: x + dx, yMeters: y + dy } },
                };
                const result = zombies.step(new Map([['session', placed]]));
                for (const zombie of zombies.snapshot(placed).zombies) {
                    const inChunk =
                        Math.abs(zombie.position.xMeters - x) < 32 &&
                        Math.abs(zombie.position.yMeters - y) < 32;
                    if (inChunk) seen.set(zombie.zombieId, zombie);
                    const blocked = result.obstacles.some(
                        obstacle =>
                            zombie.position.xMeters > obstacle.minXMeters - 0.35 &&
                            zombie.position.xMeters < obstacle.maxXMeters + 0.35 &&
                            zombie.position.yMeters > obstacle.minYMeters - 0.35 &&
                            zombie.position.yMeters < obstacle.maxYMeters + 0.35,
                    );
                    expect(blocked).toBe(false);
                }
            }
        }
        expect(seen.size).toBe(9);
    }
});

test('three hits kill a zombie and revisiting the chunk does not respawn it', () => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('session');
    const zombies = new LocalWorldZombie();
    for (let hit = 0; hit < 2; hit++)
        zombies.damage(initialZombie.zombieId, meleeWeapons.club.damage);
    expect(zombies.isAlive(initialZombie.zombieId)).toBe(true);
    zombies.damage(initialZombie.zombieId, meleeWeapons.club.damage);
    expect(zombies.isAlive(initialZombie.zombieId)).toBe(false);
    const snapshots = new Map([['session', movement.snapshot('session')]]);
    zombies.step(snapshots);
    zombies.step(new Map());
    zombies.step(snapshots);
    expect(
        zombies
            .snapshot(movement.snapshot('session'))
            .zombies.some(zombie => zombie.zombieId === initialZombie.zombieId),
    ).toBe(false);
});

test.each([
    ['club', 3],
    ['knife', 5],
    ['crowbar', 3],
    ['axe', 2],
] as const)('%s kills a 100 HP zombie in %i hits', (weapon, hits) => {
    const zombies = new LocalWorldZombie();
    for (let hit = 1; hit < hits; hit++) {
        zombies.damage(initialZombie.zombieId, meleeWeapons[weapon].damage);
        expect(zombies.isAlive(initialZombie.zombieId)).toBe(true);
    }
    zombies.damage(initialZombie.zombieId, meleeWeapons[weapon].damage);
    expect(zombies.isAlive(initialZombie.zombieId)).toBe(false);
});

test('damage from different weapons accumulates on the same zombie', () => {
    const zombies = new LocalWorldZombie();
    zombies.damage(initialZombie.zombieId, meleeWeapons.axe.damage);
    zombies.damage(initialZombie.zombieId, meleeWeapons.knife.damage);
    expect(zombies.isAlive(initialZombie.zombieId)).toBe(true);
    zombies.damage(initialZombie.zombieId, meleeWeapons.knife.damage);
    expect(zombies.isAlive(initialZombie.zombieId)).toBe(false);
});

test('damage reports only applied HP and one killing blow', () => {
    const zombies = new LocalWorldZombie();
    expect(zombies.damage(initialZombie.zombieId, 60)).toEqual({ damage: 60, isKilled: false });
    expect(zombies.damage(initialZombie.zombieId, 60)).toEqual({ damage: 40, isKilled: true });
    expect(zombies.damage(initialZombie.zombieId, 60)).toBeNull();
});
