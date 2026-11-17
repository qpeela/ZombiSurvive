import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { lootRestockSettings } from '@zombi-survive/content';
import type { GroundItem, ItemLocation } from '@zombi-survive/domain';
import { isPickupSnapshot } from '@zombi-survive/protocol';
import { updateLootRestockTimers } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

import { LocalWorldLootTimers } from '../../apps/server/src/local-world-loot-timers.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';
import { readSavedRestocks } from '../../apps/server/src/saved-loot-restock.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

const point: GroundItem = {
    itemId: 'ammo-point',
    kind: 'ammo9mm',
    quantity: 8,
    position: { xMeters: 0, yMeters: 0 },
};
const period = lootRestockSettings.periodWorldMs;
const ground: readonly ItemLocation[] = [{ type: 'ground', item: point }];

test('a partial pack occupies the point; only a fully empty point starts one game-time deadline', () => {
    const deadlines = new Map<string, number>();
    const partial: readonly ItemLocation[] = [{ type: 'ground', item: { ...point, quantity: 3 } }];
    expect(
        updateLootRestockTimers({
            points: [point],
            locations: partial,
            deadlines,
            worldTimeMs: 1000,
        }),
    ).toBeNull();
    const started = updateLootRestockTimers({
        points: [point],
        locations: [],
        deadlines,
        worldTimeMs: 1000,
    });
    expect(started?.get(point.itemId)).toBe(1000 + period);
    expect(deadlines.size).toBe(0);
    for (const time of [2000, period, period + 1000, period * 3]) {
        expect(
            updateLootRestockTimers({
                points: [point],
                locations: [],
                deadlines: started ?? deadlines,
                worldTimeMs: time,
            }),
        ).toBeNull();
    }
    expect(
        updateLootRestockTimers({
            points: [point],
            locations: ground,
            deadlines: started ?? deadlines,
            worldTimeMs: 2000,
        }),
    ).toEqual(new Map());
});

test('staged deadlines stay private until commit and survive leaving and revisiting their point', () => {
    const timers = new LocalWorldLootTimers([point]);
    timers.stage([], 60_000);
    expect(timers.snapshot(point.position)).toEqual([]);
    expect(timers.pendingSave()?.get(point.itemId)).toBe(60_000 + period);
    timers.confirmSave();
    expect(timers.pendingSave()).toBeNull();
    const expected = [
        {
            pointId: point.itemId,
            kind: point.kind,
            position: point.position,
            readyAtWorldMs: 60_000 + period,
        },
    ];
    expect(timers.snapshot(point.position)).toEqual(expected);
    expect(timers.snapshot({ xMeters: 1000, yMeters: 1000 })).toEqual([]);
    timers.register([point]);
    timers.stage([], period * 2);
    expect(timers.pendingSave()).toBeNull();
    expect(timers.snapshot(point.position)).toEqual(expected);
    const returned = timers.snapshot(point.position);
    Object.assign(returned[0]?.position ?? {}, { xMeters: 1000 });
    expect(timers.snapshot(point.position)).toEqual(expected);
});

test('an empty collected point and its deadline commit with inventory and clock, then restart unchanged', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-restock-save-'));
    const path = join(directory, 'world.sqlite');
    try {
        const store = new SoloWorldStore(path);
        const ammo = store.lootPoints().find(item => item.kind === 'ammo9mm');
        if (ammo === undefined) throw new Error('Missing ammo point.');
        const timers = new Map([[ammo.itemId, 60_000 + period]]);
        const locations = store.initialItemLocations.map(location =>
            location.item.itemId === ammo.itemId
                ? {
                      type: 'container' as const,
                      playerId: store.initialWorld.playerId,
                      item: { itemId: ammo.itemId, kind: 'ammo9mm' as const, quantity: 8 },
                      cell: { column: 0, row: 0 },
                  }
                : location,
        );
        store.saveItemLocations(locations, { worldTimeMs: 60_000, restocks: timers });
        store.close();
        const restored = new SoloWorldStore(path);
        expect(restored.initialLootRestocks).toEqual(timers);
        expect(restored.initialWorldTimeMs).toBe(60_000);
        expect(
            restored.initialItemLocations.find(location => location.item.itemId === ammo.itemId)
                ?.type,
        ).toBe('container');
        const resumed = new LocalWorldLootTimers(
            restored.lootPoints(),
            restored.initialLootRestocks,
        );
        resumed.stage(restored.initialItemLocations, 120_000);
        expect(resumed.pendingSave()).toBeNull();
        expect(resumed.snapshot(ammo.position)).toContainEqual(
            expect.objectContaining({ pointId: ammo.itemId, readyAtWorldMs: 60_000 + period }),
        );
        restored.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('v16 adds an empty registry and corrupt timers fail closed without replacing the save', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-restock-migration-'));
    const path = join(directory, 'world.sqlite');
    try {
        const seed = new SoloWorldStore(path);
        seed.savePosition({ xMeters: 0, yMeters: 0 }, 60_000);
        seed.close();
        let database = new DatabaseSync(path);
        database.exec('ALTER TABLE solo_world DROP COLUMN loot_restocks; PRAGMA user_version = 16');
        database.close();
        const migrated = new SoloWorldStore(path);
        expect(migrated.initialLootRestocks.size).toBe(0);
        expect(migrated.initialWorldTimeMs).toBe(60_000);
        migrated.close();
        database = new DatabaseSync(path);
        database
            .prepare('UPDATE solo_world SET loot_restocks = ? WHERE id = 1')
            .run('[["unknown",1000]]');
        database.close();
        const bytes = readFileSync(path);
        expect(() => new SoloWorldStore(path)).toThrow('invalid loot restock');
        expect(readFileSync(path)).toEqual(bytes);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a rejected timer write preserves ground stock, clock and the old registry together', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-restock-atomic-'));
    const path = join(directory, 'world.sqlite');
    try {
        new SoloWorldStore(path).close();
        const database = new DatabaseSync(path);
        database.exec(
            "CREATE TRIGGER reject_timer BEFORE UPDATE OF loot_restocks ON solo_world WHEN NEW.loot_restocks != OLD.loot_restocks BEGIN SELECT RAISE(ABORT, 'timer failure'); END",
        );
        database.close();
        const store = new SoloWorldStore(path);
        const ammo = store.lootPoints().find(item => item.kind === 'ammo9mm');
        if (ammo === undefined) throw new Error('Missing ammo point.');
        const locations = store.initialItemLocations.map(location =>
            location.item.itemId === ammo.itemId
                ? {
                      type: 'container' as const,
                      playerId: store.initialWorld.playerId,
                      item: { itemId: ammo.itemId, kind: 'ammo9mm' as const, quantity: 8 },
                      cell: { column: 0, row: 0 },
                  }
                : location,
        );
        expect(() => {
            store.saveItemLocations(locations, {
                worldTimeMs: 60_000,
                restocks: new Map([[ammo.itemId, period + 60_000]]),
            });
        }).toThrow('timer failure');
        store.close();
        const restored = new SoloWorldStore(path);
        expect(restored.initialWorldTimeMs).toBe(0);
        expect(restored.initialLootRestocks.size).toBe(0);
        expect(
            restored.initialItemLocations.find(location => location.item.itemId === ammo.itemId)
                ?.type,
        ).toBe('ground');
        restored.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test.each([
    [['unknown', 1000]],
    [['ammo-point', -1]],
    [['ammo-point', 1.5]],
    [['ammo-point', null]],
    [
        ['ammo-point', 1000],
        ['ammo-point', 2000],
    ],
])('invalid timer records are rejected: %j', (...records) => {
    expect(() => readSavedRestocks(JSON.stringify(records), [point])).toThrow();
});

test('restock metadata is optional, bounded and rejects duplicate or malformed point data', () => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('tab');
    const snapshot = new LocalWorldPickup().snapshot(movement.snapshot('tab'));
    const restock = {
        pointId: point.itemId,
        kind: point.kind,
        position: point.position,
        readyAtWorldMs: period,
    };
    expect(isPickupSnapshot(snapshot)).toBe(true);
    expect(isPickupSnapshot({ ...snapshot, restocks: [restock] })).toBe(true);
    for (const restocks of [
        [restock, restock],
        [{ ...restock, readyAtWorldMs: -1 }],
        [{ ...restock, kind: 'unknown' }],
        [{ ...restock, position: { xMeters: NaN, yMeters: 0 } }],
        Array.from({ length: 129 }, () => restock),
    ]) {
        expect(isPickupSnapshot({ ...snapshot, restocks })).toBe(false);
    }
});
