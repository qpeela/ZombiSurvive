import { isHealthSnapshot } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

import { LocalWorldCombat } from '../../apps/server/src/local-world-combat.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';

const setup = () => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    movement.join('tab');
    movement.join('friend', 'friend');
    const combat = new LocalWorldCombat();
    const zombie = {
        zombieId: 'zombie',
        targetPlayerId: 'solo',
        position: { xMeters: -0.9, yMeters: 0 },
    };
    const snapshots = new Map(['first', 'tab', 'friend'].map(id => [id, movement.snapshot(id)]));
    const step = () => {
        combat.step({ zombies: [zombie], snapshots, obstacles: [] });
    };

    return { movement, combat, zombie, snapshots, step };
};

test('tabs share health and cannot multiply hits; other players are unaffected', () => {
    const { movement, combat, step } = setup();
    for (let tick = 0; tick < 20; tick++) step();
    const snapshot = combat.snapshot(movement.snapshot('first'));
    expect(isHealthSnapshot(snapshot)).toBe(true);
    expect(snapshot.health).toBe(90);
    expect(combat.snapshot(movement.snapshot('tab'))).toEqual(snapshot);
    expect(combat.snapshot(movement.snapshot('friend')).health).toBe(100);
    Object.assign(snapshot, { health: 999 });
    expect(combat.snapshot(movement.snapshot('first')).health).toBe(90);
});

test('disconnect cancels windup without healing and reconnect requires a full attack delay', () => {
    const { movement, combat, zombie, step } = setup();
    for (let tick = 0; tick < 39; tick++) step();
    combat.step({ zombies: [zombie], snapshots: new Map(), obstacles: [] });
    movement.leave('first');
    movement.leave('tab');
    movement.join('rejoined');
    const connected = new Map([['rejoined', movement.snapshot('rejoined')]]);
    expect(combat.snapshot(movement.snapshot('rejoined')).health).toBe(90);
    for (let tick = 0; tick < 19; tick++)
        combat.step({ zombies: [zombie], snapshots: connected, obstacles: [] });
    expect(combat.snapshot(movement.snapshot('rejoined')).health).toBe(90);
    combat.step({ zombies: [zombie], snapshots: connected, obstacles: [] });
    expect(combat.snapshot(movement.snapshot('rejoined')).health).toBe(80);
});

test('each zombie has an independent attack interval and damage accumulates without negative HP', () => {
    const { combat, movement, zombie, snapshots } = setup();
    const zombies = Array.from({ length: 12 }, (_, index) => ({
        ...zombie,
        zombieId: `z-${String(index)}`,
    }));
    for (let tick = 0; tick < 20; tick++) combat.step({ zombies, snapshots, obstacles: [] });
    expect(combat.snapshot(movement.snapshot('first')).health).toBe(0);
    combat.step({ zombies: [], snapshots, obstacles: [] });
    combat.step({ zombies, snapshots, obstacles: [] });
    expect(combat.snapshot(movement.snapshot('first')).health).toBe(0);
});

test.each([63, 0])('restored %s HP is shared across tabs and never healed on reconnect', health => {
    const { movement, snapshots } = setup();
    const initial = { playerId: 'solo', health };
    const combat = new LocalWorldCombat(initial);
    initial.health = 100;
    combat.step({ zombies: [], snapshots, obstacles: [] });
    expect(combat.snapshot(movement.snapshot('first')).health).toBe(health);
    expect(combat.snapshot(movement.snapshot('tab')).health).toBe(health);
    movement.leave('first');
    movement.join('rejoined');
    expect(combat.snapshot(movement.snapshot('rejoined')).health).toBe(health);
});
