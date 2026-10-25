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
        { itemId: command.itemId, kind: 'bandage', cell: { column: 0, row: 0 } },
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

test('moves require the real owner, a valid footprint and a server step; retries are idempotent', () => {
    const { movement, pickup, snapshots } = setup();
    const readItems = () => pickup.snapshot(movement.snapshot('first')).items;
    const move = {
        type: 'inventory-move',
        protocolVersion: 5,
        inventoryVersion: 1,
        itemId: command.itemId,
        cell: { column: 2, row: 2 },
    };
    pickup.receiveMove('first', move); // Still on the ground.
    pickup.step(snapshots());
    expect(readItems()).toEqual([]);
    pickup.receive('first', command);
    pickup.step(snapshots());
    const original = readItems();
    pickup.receiveMove('second', { ...move, playerId: 'solo' });
    pickup.receiveMove('unknown', move);
    pickup.step(snapshots());
    expect(readItems()).toEqual(original);
    for (const value of [
        { ...move, itemId: 'missing' },
        { ...move, cell: { column: 3, row: 0 } },
        { ...move, cell: { column: 0, row: 3 } },
        { ...move, cell: { column: 0.5, row: 0 } },
        { ...move, inventoryVersion: 0 },
        {},
    ]) {
        pickup.receiveMove('first', value);
        pickup.step(snapshots());
        expect(readItems()).toEqual(original);
    }
    pickup.receiveMove('first', move);
    expect(readItems()).toEqual(original);
    pickup.leave('first');
    pickup.step(snapshots());
    expect(readItems()).toEqual(original);
    for (let count = 0; count < 100; count++) pickup.receiveMove('first', move);
    // Queue copies data instead of retaining a caller-owned mutable object.
    move.cell.column = 0;
    pickup.step(snapshots());
    expect(readItems()).toEqual([
        { itemId: command.itemId, kind: 'bandage', cell: { column: 2, row: 2 } },
    ]);
    const snapshot = readItems();
    Object.assign(snapshot[0]?.cell ?? {}, { column: 100 });
    expect(readItems()[0]?.cell).toEqual({ column: 2, row: 2 });
    pickup.receiveMove('tab', { ...move, cell: { column: 2, row: 2 } });
    pickup.step(snapshots());
    expect(readItems()).toHaveLength(1);
    const beforeReconnect = readItems();
    movement.leave('first');
    movement.join('rejoined');
    expect(pickup.snapshot(movement.snapshot('rejoined')).items).toEqual(beforeReconnect);
});
