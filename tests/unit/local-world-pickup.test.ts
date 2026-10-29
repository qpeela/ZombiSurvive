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
        inventoryVersion: 2,
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

test('durable pickup publishes only after commit on a later step; retries and queued moves stay ordered', () => {
    const movement = new LocalWorldMovement('world', 'solo', { xMeters: 2, yMeters: 2 });
    movement.join('first');
    movement.join('tab');
    const pickup = new LocalWorldPickup([{ type: 'ground', item: initialGroundItem }]);
    const sessions = () => new Map(['first', 'tab'].map(id => [id, movement.snapshot(id)]));
    const read = () => pickup.snapshot(movement.snapshot('first'));
    pickup.receive('first', command);
    pickup.receive('tab', command);
    pickup.step(sessions());
    expect(read().groundItem).toEqual(initialGroundItem);
    expect(read().items).toEqual([]);
    const pending = pickup.takePendingSave()?.[0] ?? null;
    expect(pending).toMatchObject({
        type: 'container',
        playerId: 'solo',
        cell: { column: 0, row: 0 },
    });
    expect(pickup.takePendingSave()).toBeNull();
    if (pending?.type !== 'container') throw new Error('Missing staged pickup.');
    Object.assign(pending.cell, { column: 99 });
    pickup.receiveMove('tab', {
        type: 'inventory-move',
        inventoryVersion: 2,
        protocolVersion: 5,
        itemId: command.itemId,
        cell: { column: 2, row: 2 },
    });
    pickup.step(sessions());
    expect(read().items).toEqual([]);
    pickup.confirmSave();
    expect(read().items).toEqual([]);
    pickup.step(sessions());
    expect(read().groundItem).toBeNull();
    expect(read().items[0]?.cell).toEqual({ column: 0, row: 0 });
    expect(pickup.takePendingSave()).toMatchObject([{ cell: { column: 2, row: 2 } }]);
    pickup.confirmSave();
    pickup.step(sessions());
    expect(read().items[0]?.cell).toEqual({ column: 2, row: 2 });
    pickup.receiveMove('first', {
        type: 'inventory-move',
        inventoryVersion: 2,
        protocolVersion: 5,
        itemId: command.itemId,
        cell: { column: 2, row: 2 },
    });
    pickup.step(sessions());
    expect(pickup.takePendingSave()).toBeNull();
});

test('failed or unfinished durable writes never expose a transfer; loaded placement is detached', () => {
    const movement = new LocalWorldMovement('world', 'solo', { xMeters: 2, yMeters: 2 });
    movement.join('session');
    const pickup = new LocalWorldPickup([{ type: 'ground', item: initialGroundItem }]);
    pickup.receive('session', command);
    const sessions = new Map([['session', movement.snapshot('session')]]);
    pickup.step(sessions);
    const pending = pickup.takePendingSave()?.[0] ?? null;
    for (let count = 0; count < 20; count++) pickup.step(sessions);
    expect(pickup.snapshot(movement.snapshot('session')).items).toEqual([]);
    if (pending === null) throw new Error('Missing pending write.');
    const restored = new LocalWorldPickup([pending]);
    if (pending.type === 'container') Object.assign(pending.cell, { column: 99 });
    expect(restored.snapshot(movement.snapshot('session')).groundItem).toBeNull();
    expect(restored.snapshot(movement.snapshot('session')).items[0]?.cell).toEqual({
        column: 0,
        row: 0,
    });
});

test('equipment commits before publication; racing tabs and queued stale commands keep one owner', () => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    movement.join('tab');
    movement.join('foreign', 'other');
    const seeded = new LocalWorldPickup();
    seeded.initializePlayer('solo');
    const initial = seeded.snapshot(movement.snapshot('first')).items.map(item => ({
        type: 'container' as const,
        playerId: 'solo',
        item: { itemId: item.itemId, kind: item.kind },
        cell: item.cell,
    }));
    const pickup = new LocalWorldPickup(initial);
    const sessions = new Map(['first', 'tab', 'foreign'].map(id => [id, movement.snapshot(id)]));
    const read = () => pickup.snapshot(movement.snapshot('first'));
    const equip = { type: 'equip-weapon', protocolVersion: 5, meleeVersion: 3, itemId: 'solo:axe' };
    pickup.receiveEquipment('foreign', equip);
    pickup.step(sessions);
    expect(pickup.takePendingSave()).toBeNull();
    pickup.receiveEquipment('first', equip);
    pickup.receiveEquipment('tab', equip);
    pickup.step(sessions);
    const pending = pickup.takePendingSave();
    expect(pending?.filter(location => location.type === 'hands')).toHaveLength(1);
    expect(read().hands).toBeNull();
    pickup.receiveEquipment('tab', { ...equip, itemId: 'solo:knife' });
    pickup.step(sessions);
    expect(read().hands).toBeNull();
    pickup.confirmSave();
    pickup.step(sessions);
    expect(read().hands?.itemId).toBe('solo:axe');
    expect(read().items).toHaveLength(3);
    expect(pickup.snapshot(movement.snapshot('tab'))).toEqual(read());
    const next = pickup.takePendingSave();
    expect(next?.find(location => location.type === 'hands')?.item.itemId).toBe('solo:knife');
    pickup.confirmSave();
    pickup.step(sessions);
    pickup.receiveEquipment('first', { ...equip, type: 'unequip-weapon' }); // stale old hands
    pickup.step(sessions);
    expect(read().hands?.itemId).toBe('solo:knife');
    expect(pickup.takePendingSave()).toBeNull();
    pickup.receiveEquipment('tab', { ...equip, itemId: 'solo:knife', type: 'unequip-weapon' });
    pickup.leave('tab');
    pickup.step(sessions);
    expect(pickup.takePendingSave()).toBeNull();
});
