import { initialZombie } from '@zombi-survive/content';
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

test('far-away saved players do not activate or receive the starting zombie', () => {
    const movement = new LocalWorldMovement('world', 'solo', { xMeters: 1000, yMeters: -1000 });
    movement.join('session');
    const zombie = new LocalWorldZombie();
    zombie.step(new Map([['session', movement.snapshot('session')]]));
    expect(zombie.snapshot(movement.snapshot('session')).zombies).toEqual([]);
});
