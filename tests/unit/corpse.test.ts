import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Corpse, ItemLocation, PlayerMovementState } from '@zombi-survive/domain';
import { isPickupSnapshot } from '@zombi-survive/protocol';
import { pickUpItem } from '@zombi-survive/simulation';
import { afterEach, expect, test } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';
import { readSavedCorpses } from '../../apps/server/src/saved-corpse.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});
const pathForTest = () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-corpse-'));
    directories.push(directory);
    return join(directory, 'world.sqlite');
};
const corpse: Corpse = {
    corpseId: 'body',
    playerId: 'dead',
    diedAtMs: 1234,
    position: { xMeters: 0, yMeters: 0 },
};
const knife: ItemLocation = {
    type: 'corpse',
    corpseId: 'body',
    item: { itemId: 'dead:knife', kind: 'knife' },
};
const player: PlayerMovementState = {
    playerId: 'living',
    position: { xMeters: 0, yMeters: 1 },
    stamina: 1,
    isExhausted: false,
    isSneaking: false,
    noiseRadiusMeters: 0,
};

test('corpse transfer uses the same reach and space rules and cannot replay or cross a wall', () => {
    const transfer = (overrides: Partial<Parameters<typeof pickUpItem>[0]> = {}) =>
        pickUpItem({
            location: knife,
            player,
            corpse,
            itemId: knife.item.itemId,
            obstacles: [],
            ...overrides,
        });
    const picked = transfer();
    expect(picked).toMatchObject({ type: 'container', playerId: 'living', item: knife.item });
    expect(transfer({ location: picked })).toBe(picked);
    expect(transfer({ corpse: { ...corpse, corpseId: 'wrong' } })).toBe(knife);
    expect(transfer({ player: { ...player, position: { xMeters: 0, yMeters: 2 } } })).toBe(knife);
    expect(
        transfer({
            obstacles: [
                { id: 'wall', minXMeters: -2, maxXMeters: 2, minYMeters: 0.4, maxYMeters: 0.5 },
            ],
        }),
    ).toBe(knife);
    const items = Array.from({ length: 3 }, (_, row) => ({
        itemId: `axe-${String(row)}`,
        kind: 'axe' as const,
        cell: { column: 0, row },
    }));
    expect(transfer({ items })).toBe(knife);
    const full = Array.from({ length: 12 }, (_, index) => ({
        itemId: `knife-${String(index)}`,
        kind: 'knife' as const,
        cell: { column: index % 4, row: Math.floor(index / 4) },
    }));
    expect(transfer({ items: full })).toBe(knife);
});

test('pending death includes hands and simultaneous transfers, stays hidden until commit and survives duplicate pickup', () => {
    const movement = new LocalWorldMovement('world', 'dead');
    movement.join('dead');
    movement.join('living', 'living');
    const pickup = new LocalWorldPickup([{ type: 'hands', playerId: 'dead', item: knife.item }]);
    pickup.stageDeath(corpse);
    expect(pickup.snapshot(movement.snapshot('dead')).hands).toEqual(knife.item);
    expect(pickup.takePendingSave()).toEqual([knife]);
    pickup.confirmSave();
    pickup.setCorpses([corpse]);
    expect(pickup.snapshot(movement.snapshot('dead'))).toMatchObject({
        hands: null,
        items: [],
        corpses: [{ ...corpse, items: [knife.item] }],
    });
    movement.receive('living', {
        type: 'movement-target',
        protocolVersion: 5,
        sequence: 1,
        target: { xMeters: 0, yMeters: 0 },
        isSprinting: false,
        isSneaking: false,
    });
    for (let tick = 0; tick < 4; tick++) movement.step();
    const sessions = new Map([['living', movement.snapshot('living')]]);
    const command = { type: 'pickup-item', protocolVersion: 5, itemId: knife.item.itemId };
    pickup.receive('living', command);
    pickup.step(sessions, () => 0);
    expect(pickup.takePendingSave()).toBeNull();
    pickup.receive('living', command);
    pickup.step(sessions);
    expect(pickup.takePendingSave()).toMatchObject([{ type: 'container', playerId: 'living' }]);
    pickup.confirmSave();
    pickup.receive('living', command);
    pickup.step(sessions);
    expect(pickup.takePendingSave()).toBeNull();
    expect(pickup.snapshot(movement.snapshot('living')).items).toHaveLength(1);
});

test('a v8 dead save migrates once, retains every ID and restores its corpse across chunks', () => {
    const path = pathForTest();
    let store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    const original = store.initialItemLocations;
    store.saveCombat({ health: 0, cooldownTicks: 0, bleedingTicks: 1 }, undefined, {
        xMeters: -32,
        yMeters: -32,
    });
    store.close();
    const database = new DatabaseSync(path);
    database.exec('ALTER TABLE solo_world DROP COLUMN corpses; PRAGMA user_version = 8');
    database.close();
    store = new SoloWorldStore(path);
    const bodies = store.initialCorpses;
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ playerId, position: { xMeters: -32, yMeters: -32 } });
    expect(store.initialItemLocations.filter(location => location.type === 'corpse')).toHaveLength(
        4,
    );
    expect(store.initialItemLocations.map(location => location.item.itemId)).toEqual(
        original.map(location => location.item.itemId),
    );
    store.close();
    store = new SoloWorldStore(path);
    expect(store.initialCorpses).toEqual(bodies);
    const movement = new LocalWorldMovement(store.initialWorld.worldId, playerId, {
        xMeters: -32,
        yMeters: -32,
    });
    movement.join('tab');
    const pickup = new LocalWorldPickup(store.initialItemLocations, bodies);
    expect(pickup.snapshot(movement.snapshot('tab')).corpses).toHaveLength(1);
    expect(isPickupSnapshot(pickup.snapshot(movement.snapshot('tab')))).toBe(true);
    store.close();
});

test('failed body transaction retains previous health, position and item ownership', () => {
    const path = pathForTest();
    let store = new SoloWorldStore(path);
    const locations = store.initialItemLocations;
    const body = { ...corpse, playerId: store.initialWorld.playerId };
    store.close();
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_body BEFORE UPDATE OF corpses ON solo_world BEGIN SELECT RAISE(ABORT, 'body disk failure'); END",
    );
    database.close();
    store = new SoloWorldStore(path);
    const pickup = new LocalWorldPickup(locations);
    pickup.stageDeath(body);
    const pending = pickup.takePendingSave();
    if (pending === null) throw new Error('Missing death items');
    expect(() => {
        store.saveCombat(
            { health: 0, cooldownTicks: 0, bleedingTicks: 0 },
            pending,
            body.position,
            [body],
        );
    }).toThrow(/body disk failure/);
    store.close();
    store = new SoloWorldStore(path);
    expect(store.initialCombat.health).toBe(100);
    expect(store.initialItemLocations).toEqual(locations);
    expect(store.initialCorpses).toEqual([]);
    store.close();
});

test('corrupt bodies and dangling container references fail without overwriting the save', () => {
    for (const value of [
        '{}',
        JSON.stringify([corpse, corpse]),
        JSON.stringify([{ ...corpse, diedAtMs: -1 }]),
        JSON.stringify([{ ...corpse, position: { xMeters: null, yMeters: 0 } }]),
    ]) {
        expect(() => readSavedCorpses(value, [])).toThrow(/corpses/);
    }
    expect(() => readSavedCorpses('[]', [knife])).toThrow(/corpses/);
    const path = pathForTest();
    new SoloWorldStore(path).close();
    const database = new DatabaseSync(path);
    database.exec("UPDATE solo_world SET corpses = '{}'");
    database.close();
    const before = readFileSync(path);
    expect(() => new SoloWorldStore(path)).toThrow(/corpses/);
    expect(readFileSync(path)).toEqual(before);
});

test('wire snapshots reject malformed corpse positions, duplicate body and item IDs', () => {
    const movement = new LocalWorldMovement('world', 'dead');
    movement.join('tab');
    const pickup = new LocalWorldPickup([knife], [corpse]);
    const snapshot = pickup.snapshot(movement.snapshot('tab'));
    expect(isPickupSnapshot(snapshot)).toBe(true);
    for (const corpses of [
        [{ ...corpse, items: [knife.item, knife.item] }],
        [{ ...corpse, items: [], diedAtMs: -1 }],
        [{ ...corpse, items: [], position: { xMeters: NaN, yMeters: 0 } }],
        [snapshot.corpses?.[0], snapshot.corpses?.[0]],
    ]) {
        expect(isPickupSnapshot({ ...snapshot, corpses })).toBe(false);
    }
});

test('repeated lives keep nearby corpse snapshots within the validated wire bound', () => {
    const movement = new LocalWorldMovement('world', 'dead');
    movement.join('tab');
    const bodies = Array.from({ length: 129 }, (_, index) => ({
        ...corpse,
        corpseId: `body-${String(index)}`,
    }));
    const pickup = new LocalWorldPickup([], bodies);
    const snapshot = pickup.snapshot(movement.snapshot('tab'));
    expect(snapshot.corpses).toHaveLength(128);
    expect(isPickupSnapshot(snapshot)).toBe(true);
});
