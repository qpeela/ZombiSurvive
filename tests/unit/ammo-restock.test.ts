import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lootRestockSettings } from '@zombi-survive/content';
import { type GroundItem, type ItemLocation } from '@zombi-survive/domain';
import { replenishAmmo, updateLootRestockTimers } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

import { readSavedItems } from '../../apps/server/src/saved-item.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

const point: GroundItem = {
    itemId: 'ammo-point',
    kind: 'ammo9mm',
    quantity: 8,
    position: { xMeters: 0, yMeters: 0 },
};
const deadline = lootRestockSettings.periodWorldMs;
const deadlines = new Map([[point.itemId, deadline]]);
const carried: ItemLocation = {
    type: 'container',
    playerId: 'solo',
    cell: { column: 0, row: 0 },
    item: { itemId: point.itemId, kind: 'ammo9mm', quantity: 3 },
};

test('one new instance appears exactly at the deadline, preserving carried stock', () => {
    const input = { points: [point], locations: [carried], deadlines };
    expect(replenishAmmo({ ...input, worldTimeMs: deadline - 1 })).toBeNull();
    const next = replenishAmmo({ ...input, worldTimeMs: deadline });
    expect(next).toEqual([
        carried,
        {
            type: 'ground',
            item: {
                ...point,
                itemId: `${point.itemId}:restock:${String(deadline)}`,
            },
        },
    ]);
    expect(
        replenishAmmo({ ...input, locations: next ?? [], worldTimeMs: deadline * 4 }),
    ).toBeNull();
    expect(
        updateLootRestockTimers({ ...input, locations: next ?? [], worldTimeMs: deadline }),
    ).toEqual(new Map());
});

test('a partial replenished pack keeps its point occupied over multiple periods', () => {
    const partial: ItemLocation = {
        type: 'ground',
        item: {
            ...point,
            itemId: `${point.itemId}:restock:1000`,
            quantity: 2,
        },
    };
    expect(
        replenishAmmo({
            points: [point],
            locations: [carried, partial],
            deadlines,
            worldTimeMs: deadline * 10,
        }),
    ).toBeNull();
    expect(
        updateLootRestockTimers({
            points: [point],
            locations: [partial],
            deadlines: new Map(),
            worldTimeMs: deadline * 10,
        }),
    ).toBeNull();
});

test('collecting the replacement starts a fresh period with a different instance ID', () => {
    const first = replenishAmmo({
        points: [point],
        locations: [],
        deadlines,
        worldTimeMs: deadline,
    });
    const item = first?.[0]?.item;
    if (item === undefined || item.kind !== 'ammo9mm') throw new Error('Missing pack.');
    const locations: ItemLocation[] = [{ type: 'consumed', item: { ...item, quantity: 0 } }];
    const nextDeadlines = updateLootRestockTimers({
        points: [point],
        locations,
        deadlines: new Map(),
        worldTimeMs: deadline + 1000,
    });
    expect(nextDeadlines?.get(point.itemId)).toBe(deadline * 2 + 1000);
    expect(
        replenishAmmo({
            points: [point],
            locations,
            deadlines: nextDeadlines ?? new Map(),
            worldTimeMs: deadline * 2 + 1000,
        })?.[1]?.item.itemId,
    ).not.toBe(item.itemId);
});

test('replenished ammo round-trips with original ownership; malformed or duplicate stock fails closed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-ammo-restock-'));
    const path = join(directory, 'world.sqlite');
    try {
        const store = new SoloWorldStore(path);
        const ammo = store.lootPoints().find(item => item.kind === 'ammo9mm');
        if (ammo === undefined) throw new Error('Missing point.');
        const locations: readonly ItemLocation[] = store.initialItemLocations.map(location => {
            if (location.item.itemId === ammo.itemId)
                return {
                    ...carried,
                    playerId: store.initialWorld.playerId,
                    item: { itemId: ammo.itemId, kind: 'ammo9mm', quantity: 3 },
                };
            if (location.type === 'container') return { type: 'expired', item: location.item };

            return location;
        });
        const next = replenishAmmo({
            points: [ammo],
            locations,
            deadlines: new Map([[ammo.itemId, deadline]]),
            worldTimeMs: deadline,
        });
        if (next === null) throw new Error('Missing replacement.');
        store.saveItemLocations(next, { worldTimeMs: deadline, restocks: new Map() });
        const read = (value: unknown) =>
            readSavedItems(
                JSON.stringify(value),
                store.initialWorld.playerId,
                store.lootPoints().filter(item => item.kind !== 'bandage'),
                true,
            );
        expect(() => read([...next, next.at(-1)])).toThrow();
        expect(() => read(next.filter(location => location.item.itemId !== ammo.itemId))).toThrow();
        expect(() => read([...next, { type: 'ground', item: ammo }])).toThrow();
        expect(() =>
            read(
                next.map(location =>
                    location === next.at(-1)
                        ? {
                              type: 'ground',
                              item: { ...ammo, itemId: `${ammo.itemId}:restock:01` },
                          }
                        : location,
                ),
            ),
        ).toThrow();
        store.close();
        const restored = new SoloWorldStore(path);
        expect(restored.initialItemLocations).toEqual(next);
        expect(restored.initialLootRestocks.size).toBe(0);
        restored.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
