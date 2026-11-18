import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
    lootRestockSettings,
    medicalOutpost,
    worldGenerationSettings,
} from '@zombi-survive/content';
import { copyItem, type ItemLocation } from '@zombi-survive/domain';
import { replenishLoot, resolveMovement, useBandage } from '@zombi-survive/simulation';
import { generateChunkLoot, generateWorldChunk } from '@zombi-survive/worldgen';
import { afterEach, expect, test } from 'vitest';

import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});
const setup = () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-medical-'));
    directories.push(directory);
    const path = join(directory, 'world.sqlite');
    return { path, store: new SoloWorldStore(path) };
};
const key = {
    seed: worldGenerationSettings.initialSeed,
    generatorVersion: 1,
    chunkX: 1,
    chunkY: 0,
};
const loot = generateChunkLoot(key);
const point = loot.find(item => item.itemId === medicalOutpost.bandageItemId);
if (point === undefined) throw new Error('Missing medical bandage.');
const period = lootRestockSettings.periodWorldMs;

const visited = (store: SoloWorldStore): readonly ItemLocation[] => [
    ...store.initialItemLocations,
    ...loot.map(item => ({ type: 'ground' as const, item })),
];

test('the bandage is inside identifiable eastern ruins with a traversable southern entrance', () => {
    expect(loot.filter(item => item.kind === 'bandage')).toEqual([point]);
    expect(generateChunkLoot({ ...key, chunkX: 2 }).some(item => item.kind === 'bandage')).toBe(
        false,
    );
    const { obstacles } = generateWorldChunk(key);
    const inside = { xMeters: 68, yMeters: 4 };
    expect(resolveMovement(medicalOutpost.entrance, inside, obstacles)).toEqual(inside);
    expect(resolveMovement(inside, medicalOutpost.bandagePosition, obstacles)).toEqual(
        medicalOutpost.bandagePosition,
    );
});

test('v18 adds one bandage to an already visited outpost, retaining health, position and old items on repeated load', () => {
    const { path, store } = setup();
    const oldLocations = visited(store).filter(location => location.item.itemId !== point.itemId);
    store.saveItemLocations(visited(store));
    store.saveCombat(
        { health: 67, cooldownTicks: 3, bleedingTicks: 50 },
        undefined,
        medicalOutpost.entrance,
    );
    store.close();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(oldLocations));
    database.exec('PRAGMA user_version = 18');
    database.close();
    for (let attempt = 0; attempt < 2; attempt++) {
        const restored = new SoloWorldStore(path);
        try {
            expect(restored.initialItemLocations).toEqual([
                ...oldLocations,
                { type: 'ground', item: point },
            ]);
            expect(restored.initialWorld.position).toEqual(medicalOutpost.entrance);
            expect(restored.initialCombat).toEqual({
                health: 67,
                cooldownTicks: 3,
                bleedingTicks: 50,
            });
        } finally {
            restored.close();
        }
    }
});

test('consumption retains a non-playable bandage record, duplicate use cannot remove another one and multiple missed periods replenish once', () => {
    const { path, store } = setup();
    const playerId = store.initialWorld.playerId;
    const locations: readonly ItemLocation[] = visited(store).map(location =>
        location.item.itemId === point.itemId
            ? { type: 'container', item: copyItem(point), playerId, cell: { column: 0, row: 0 } }
            : location,
    );
    const player = { playerId, health: 70, bleedingTicks: 100 };
    const used = useBandage({ locations, player, itemId: point.itemId });
    expect(used.player).toEqual({ ...player, bleedingTicks: 0 });
    expect(used.locations.find(location => location.item.itemId === point.itemId)).toEqual({
        type: 'consumed',
        item: copyItem(point),
    });
    expect(useBandage({ ...used, player, itemId: point.itemId }).locations).toBe(used.locations);
    const deadlines = new Map([[point.itemId, period]]);
    store.saveCombat(
        { health: 70, cooldownTicks: 0, bleedingTicks: 0 },
        used.locations,
        undefined,
        undefined,
        undefined,
        undefined,
        { worldTimeMs: period * 4, restocks: deadlines },
    );
    store.close();
    const restored = new SoloWorldStore(path);
    try {
        expect(restored.initialItemLocations).toEqual(used.locations);
        const next = replenishLoot({
            points: restored.lootPoints(),
            locations: restored.initialItemLocations,
            deadlines: restored.initialLootRestocks,
            worldTimeMs: restored.initialWorldTimeMs,
        });
        expect(
            next?.filter(
                location =>
                    location.type === 'ground' &&
                    location.item.kind === 'bandage' &&
                    location.item.itemId.startsWith(point.itemId),
            ),
        ).toEqual([
            {
                type: 'ground',
                item: { ...point, itemId: `${point.itemId}:restock:${String(period)}` },
            },
        ]);
        expect(
            replenishLoot({
                points: restored.lootPoints(),
                locations: next ?? [],
                deadlines,
                worldTimeMs: period * 10,
            }),
        ).toBeNull();
        restored.saveItemLocations(next ?? [], { worldTimeMs: period * 4, restocks: new Map() });
    } finally {
        restored.close();
    }
    const again = new SoloWorldStore(path);
    try {
        expect(
            again.initialItemLocations.filter(location =>
                location.item.itemId.startsWith(point.itemId),
            ),
        ).toHaveLength(2);
    } finally {
        again.close();
    }
});

test('a carried original remains separate from the replenished bandage and duplicate or missing records fail closed', () => {
    const { path, store } = setup();
    const carried: ItemLocation = {
        type: 'container',
        playerId: store.initialWorld.playerId,
        cell: { column: 0, row: 0 },
        item: copyItem(point),
    };
    const locations = visited(store).map(location =>
        location.item.itemId === point.itemId ? carried : location,
    );
    const next = replenishLoot({
        points: [...store.lootPoints(), point],
        locations,
        deadlines: new Map([[point.itemId, period]]),
        worldTimeMs: period,
    });
    expect(next?.find(location => location.item.itemId === point.itemId)).toEqual(carried);
    store.saveItemLocations(next ?? []);
    expect(() => {
        store.saveItemLocations(
            next?.filter(location => location.item.itemId !== point.itemId) ?? [],
        );
    }).toThrow();
    expect(() => {
        store.saveItemLocations([
            ...(next ?? []),
            { type: 'ground', item: { ...point, itemId: `${point.itemId}:restock:1` } },
        ]);
    }).toThrow();
    store.close();
    const restored = new SoloWorldStore(path);
    try {
        expect(restored.initialItemLocations).toEqual(next);
    } finally {
        restored.close();
    }
});
