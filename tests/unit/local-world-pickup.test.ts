import { initialGroundItem } from '@zombi-survive/content';
import { isPickupSnapshot } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';

const command = { type: 'pickup-item', protocolVersion: 5, itemId: initialGroundItem.itemId };
const setup = () => {
    const movement = new LocalWorldMovement('world', 'solo', { xMeters: 2, yMeters: 2 });
    movement.join('first');
    movement.join('second', 'other');
    movement.join('tab');
    const pickup = new LocalWorldPickup();
    const snapshots = () =>
        new Map(['first', 'second', 'tab'].map(id => [id, movement.snapshot(id)]));

    return { movement, pickup, snapshots };
};

test('only a step can transfer an item; competing sessions have exactly one owner', () => {
    const { movement, pickup, snapshots } = setup();
    // Both different players stand within range of the item.
    movement.receive('second', {
        type: 'movement-target',
        protocolVersion: 5,
        sequence: 1,
        target: { xMeters: 2, yMeters: 2 },
        isSprinting: false,
        isSneaking: false,
    });
    for (let tick = 0; tick < 4; tick++) movement.step();
    pickup.receive('first', {
        ...command,
        playerId: 'other',
        position: { xMeters: 999, yMeters: 999 },
    });
    pickup.receive('second', command);
    expect(pickup.snapshot(movement.snapshot('first')).groundItem).not.toBeNull();
    pickup.step(snapshots());
    expect(pickup.snapshot(movement.snapshot('first')).items).toEqual([
        { itemId: command.itemId, kind: 'bandage' },
    ]);
    expect(pickup.snapshot(movement.snapshot('second')).items).toEqual([]);
    expect(pickup.snapshot(movement.snapshot('tab')).items).toHaveLength(1);
    for (let count = 0; count < 100; count++) pickup.receive('first', command);
    pickup.step(snapshots());
    expect(pickup.snapshot(movement.snapshot('first')).items).toHaveLength(1);
    movement.leave('first');
    movement.join('rejoined');
    expect(pickup.snapshot(movement.snapshot('rejoined')).items).toHaveLength(1);
    expect(isPickupSnapshot(pickup.snapshot(movement.snapshot('rejoined')))).toBe(true);
});

test('malformed, unknown, distant and disconnected sessions leave the item on the ground', () => {
    const { movement, pickup, snapshots } = setup();
    for (const value of [
        null,
        {},
        { ...command, protocolVersion: 4 },
        { ...command, itemId: 'missing' },
    ]) {
        pickup.receive('first', value);
        pickup.step(snapshots());
        expect(pickup.snapshot(movement.snapshot('first')).groundItem).toEqual(initialGroundItem);
    }
    pickup.receive('first', command);
    pickup.leave('first');
    pickup.receive('unknown', command);
    pickup.receive('second', command); // (2, 0) is outside the 1.5m range.
    pickup.step(snapshots());
    expect(pickup.snapshot(movement.snapshot('first')).groundItem).toEqual(initialGroundItem);
    expect(pickup.snapshot(movement.snapshot('first')).items).toEqual([]);
});

test('snapshot consumers cannot mutate the server-owned item or container', () => {
    const { movement, pickup, snapshots } = setup();
    const first = pickup.snapshot(movement.snapshot('first'));
    Object.assign(first.groundItem?.position ?? {}, { xMeters: 500 });
    expect(pickup.snapshot(movement.snapshot('first')).groundItem).toEqual(initialGroundItem);
    pickup.receive('first', command);
    pickup.step(snapshots());
    Object.assign(pickup.snapshot(movement.snapshot('first')).items[0] ?? {}, {
        itemId: 'changed',
    });
    expect(pickup.snapshot(movement.snapshot('first')).items[0]?.itemId).toBe(command.itemId);
});
