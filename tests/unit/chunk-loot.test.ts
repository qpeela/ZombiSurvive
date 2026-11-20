import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
    collisionSettings,
    militaryWarehouse,
    worldGenerationSettings,
} from '@zombi-survive/content';
import { copyItem, isWeaponId, type ItemLocation, type ZombieState } from '@zombi-survive/domain';
import {
    movementStepSeconds,
    resolveMovement,
    stepGunshotInvestigation,
} from '@zombi-survive/simulation';
import {
    generateChunkLoot,
    generateWorldAmmoLoot,
    generateWorldChunk,
    generateWorldWeaponLoot,
    warehouseLoot,
} from '@zombi-survive/worldgen';
import { afterEach, expect, test } from 'vitest';

import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});
const open = (path: string) => {
    const store = new SoloWorldStore(path);
    cleanups.unshift(() => {
        store.close();
    });
    return store;
};
const create = () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-chunk-loot-'));
    cleanups.push(() => {
        rmSync(directory, { recursive: true, force: true });
    });
    const path = join(directory, 'world.sqlite');
    return { path, store: open(path) };
};
const lootFor = (chunkX: number, chunkY: number) =>
    generateChunkLoot({
        seed: worldGenerationSettings.initialSeed,
        generatorVersion: 1,
        chunkX,
        chunkY,
    });
const groundFor = (chunkX: number, chunkY: number): readonly ItemLocation[] =>
    lootFor(chunkX, chunkY).map(item => ({ type: 'ground', item }));

test('every sampled chunk initially has a weapon and ammo, including old layers, across seeds and negative/far coordinates', () => {
    const coordinates = [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [-2, 3],
        [6, -7],
        [999999, -999999],
    ] as const;
    for (let index = 0; index < 20; index++) {
        const seed = `chunk-loot-${String(index)}`;
        const previous = [...generateWorldWeaponLoot(seed), ...generateWorldAmmoLoot(seed)];
        for (const [chunkX, chunkY] of coordinates) {
            const key = { seed, generatorVersion: 1, chunkX, chunkY };
            const loot = generateChunkLoot(key);
            expect(loot).toEqual(generateChunkLoot(key));
            const chunk = generateWorldChunk(key);
            const inChunk = [...previous, ...loot].filter(
                item =>
                    Math.floor((item.position.xMeters + 32) / 64) === chunkX &&
                    Math.floor((item.position.yMeters + 32) / 64) === chunkY,
            );
            expect(inChunk.some(item => isWeaponId(item.kind))).toBe(true);
            expect(inChunk.some(item => item.kind === 'ammo9mm')).toBe(true);
            expect(new Set(loot.map(item => item.itemId)).size).toBe(loot.length);
            for (const item of loot) {
                const half = collisionSettings.playerHalfSizeMeters;
                expect(
                    chunk.obstacles.some(
                        obstacle =>
                            item.position.xMeters > obstacle.minXMeters - half &&
                            item.position.xMeters < obstacle.maxXMeters + half &&
                            item.position.yMeters > obstacle.minYMeters - half &&
                            item.position.yMeters < obstacle.maxYMeters + half,
                    ),
                ).toBe(false);
                expect(inChunk).toContainEqual(item);
                if (item.kind === 'ammo9mm') expect(item.quantity).toBe(8);
                if (item.kind === 'pistol')
                    expect(item).toMatchObject({ rounds: 8, magazineCapacity: 8 });
            }
        }
    }
    expect(lootFor(0, 0)).toEqual([]);
    expect(lootFor(1, 0).map(item => item.kind)).toEqual(['ammo9mm', 'bandage']);
});

test('new loot sites are reachable through the real navigation with the player collider footprint', () => {
    for (const [chunkX, chunkY] of [
        [0, -1],
        [-1, -1],
        [1, 0],
        [2, 3],
    ] as const) {
        const obstacles = generateWorldChunk({
            seed: worldGenerationSettings.initialSeed,
            generatorVersion: 1,
            chunkX,
            chunkY,
        }).obstacles;
        for (const item of lootFor(chunkX, chunkY)) {
            let zombie: ZombieState = {
                zombieId: 'route-probe',
                targetPlayerId: null,
                position: { xMeters: chunkX * 64, yMeters: chunkY * 64 },
            };
            const distance = () =>
                Math.hypot(
                    zombie.position.xMeters - item.position.xMeters,
                    zombie.position.yMeters - item.position.yMeters,
                );
            for (let tick = 0; tick < 800 && distance() > 1.4; tick++)
                zombie = stepGunshotInvestigation({
                    zombie,
                    heard: { position: item.position, expiresAtTick: 1000 },
                    tick,
                    obstacles,
                    stepSeconds: movementStepSeconds,
                });
            expect(distance()).toBeLessThanOrEqual(1.4);
        }
    }
});

test('v12 migration preserves the complete old world and adds a registry without granting replacement items', () => {
    const { path, store } = create();
    store.saveDisplayName('Исследователь');
    store.saveCombat({ health: 63, cooldownTicks: 4, bleedingTicks: 81, lifeRevision: 2 });
    const original = store.initialItemLocations;
    const worldId = store.initialWorld.worldId;
    store.close();
    const database = new DatabaseSync(path);
    database.exec('ALTER TABLE solo_world DROP COLUMN loot_chunks; PRAGMA user_version = 12');
    database.close();
    let loaded = open(path);
    expect(loaded.initialWorld).toMatchObject({ worldId, displayName: 'Исследователь' });
    expect(loaded.initialCombat).toEqual({
        health: 63,
        cooldownTicks: 4,
        bleedingTicks: 81,
        lifeRevision: 2,
    });
    expect(loaded.initialItemLocations).toEqual(original);
    loaded.close();
    loaded = open(path);
    expect(loaded.initialItemLocations).toEqual(original);
    loaded.close();
    const migrated = new DatabaseSync(path);
    expect(migrated.prepare('PRAGMA user_version').get()?.['user_version']).toBe(21);
    expect(migrated.prepare('SELECT loot_chunks FROM solo_world').get()?.['loot_chunks']).toBe(
        '[]',
    );
    migrated.close();
});

test('new chunk keys and items commit together; consumed ammo and expired weapons never reappear', () => {
    const { path, store } = create();
    const added = groundFor(0, -1);
    const locations: readonly ItemLocation[] = [...store.initialItemLocations, ...added].map(
        location => {
            if (location.item.itemId === 'chunk-loot-v1:0:-1:weapon')
                return { type: 'expired', item: copyItem(location.item) };
            if (location.item.itemId === 'chunk-loot-v1:0:-1:ammo')
                return {
                    type: 'consumed',
                    item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity: 0 },
                };
            return location;
        },
    );
    store.saveItemLocations(locations);
    store.close();
    let loaded = open(path);
    expect(loaded.initialItemLocations).toEqual(locations);
    loaded.saveCombat({ health: 100, cooldownTicks: 0, bleedingTicks: 0 }, [
        ...loaded.initialItemLocations,
        ...groundFor(1, 0),
    ]);
    loaded.close();
    loaded = open(path);
    expect(loaded.initialItemLocations).toHaveLength(23 + warehouseLoot.length);
    expect(
        loaded.initialItemLocations.filter(location => location.type === 'expired'),
    ).toHaveLength(1);
    expect(
        loaded.initialItemLocations.filter(location => location.type === 'consumed'),
    ).toHaveLength(1);
});

test('the warehouse has accessible and distinct pistol and ammunition spots', () => {
    const { chunkX, chunkY, entrance, floor } = militaryWarehouse;
    const chunk = generateWorldChunk({
        seed: worldGenerationSettings.initialSeed,
        generatorVersion: worldGenerationSettings.generatorVersion,
        chunkX,
        chunkY,
    });
    expect(warehouseLoot.map(item => item.kind)).toEqual([
        'pistol',
        'ammo9mm',
        'pistol',
        'ammo9mm',
    ]);
    expect(lootFor(chunkX, chunkY)).toEqual(expect.arrayContaining([...warehouseLoot]));
    const warehouseIds = new Set(warehouseLoot.map(item => item.itemId));
    expect(lootFor(chunkX + 1, chunkY).some(item => warehouseIds.has(item.itemId))).toBe(false);

    for (const item of warehouseLoot) {
        expect(item.position.xMeters).toBeGreaterThan(floor.minXMeters);
        expect(item.position.xMeters).toBeLessThan(floor.minXMeters + floor.widthMeters);
        expect(item.position.yMeters).toBeGreaterThan(floor.minYMeters);
        expect(item.position.yMeters).toBeLessThan(floor.minYMeters + floor.heightMeters);
        expect(resolveMovement(entrance, item.position, chunk.obstacles)).toEqual(item.position);
    }
});

test('a visited v19 warehouse gains stock once and preserves picked-up and spent items', () => {
    const { path, store } = create();
    const { chunkX, chunkY } = militaryWarehouse;
    const originalIds = new Set(warehouseLoot.map(item => item.itemId));
    const oldNorthLoot = groundFor(chunkX, chunkY).filter(
        ({ item }) => !originalIds.has(item.itemId),
    );
    const oldItems = [...store.initialItemLocations, ...oldNorthLoot];
    const world = store.initialWorld;
    store.close();

    const database = new DatabaseSync(path);
    database
        .prepare('UPDATE solo_world SET loot_chunks = ?, item_location = ?')
        .run(JSON.stringify([`${String(chunkX)},${String(chunkY)}`]), JSON.stringify(oldItems));
    database.exec('PRAGMA user_version = 19');
    database.close();

    const migrated = open(path);
    expect(migrated.initialWorld).toEqual(world);
    expect(migrated.initialItemLocations).toHaveLength(oldItems.length + warehouseLoot.length);
    expect(migrated.initialItemLocations).toEqual(expect.arrayContaining(oldItems));
    const newItems = migrated.initialItemLocations.filter(({ item }) =>
        originalIds.has(item.itemId),
    );
    expect(newItems).toEqual(warehouseLoot.map(item => ({ type: 'ground', item })));
    const pickedUp = migrated.initialItemLocations.map((location): ItemLocation => {
        const { item } = location;
        if (item.itemId.endsWith(':warehouse-pistol-1')) {
            return { type: 'hands', playerId: world.playerId, item: copyItem(item) };
        }
        if (item.itemId.endsWith(':warehouse-ammo-1') && item.kind === 'ammo9mm') {
            return {
                type: 'consumed',
                item: { itemId: item.itemId, kind: item.kind, quantity: 0 },
            };
        }

        return location;
    });
    migrated.saveItemLocations(pickedUp);
    migrated.close();
    expect(open(path).initialItemLocations).toEqual(pickedUp);
});

test('a larger visited manifest restores beyond the former 16KB cap without relaxing exact ownership/ID checks', () => {
    const { path, store } = create();
    const locations = [...store.initialItemLocations];
    for (let chunkX = 2; chunkX < 82; chunkX++) locations.push(...groundFor(chunkX, -2));
    expect(JSON.stringify(locations).length).toBeGreaterThan(16384);
    store.saveItemLocations(locations);
    store.close();
    const loaded = open(path);
    expect(loaded.initialItemLocations).toEqual(locations);
    expect(() => {
        loaded.saveItemLocations(locations.slice(0, -1));
    }).toThrow(/invalid item location/);
});

test('failed full update preserves health, items and registry and does not poison a subsequent valid save', () => {
    const { path, store } = create();
    store.close();
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_chunk BEFORE UPDATE OF loot_chunks ON solo_world WHEN NEW.loot_chunks != '[]' BEGIN SELECT RAISE(ABORT, 'chunk disk failure'); END",
    );
    database.close();
    const loaded = open(path);
    expect(() => {
        loaded.saveCombat({ health: 42, cooldownTicks: 0, bleedingTicks: 0 }, [
            ...loaded.initialItemLocations,
            ...groundFor(0, -1),
        ]);
    }).toThrow(/chunk disk failure/);
    loaded.saveCombat(
        { health: 77, cooldownTicks: 0, bleedingTicks: 0 },
        loaded.initialItemLocations,
    );
    loaded.close();
    const restored = open(path);
    expect(restored.initialCombat.health).toBe(77);
    expect(restored.initialItemLocations).toHaveLength(19);
    restored.close();
    const raw = new DatabaseSync(path);
    expect(raw.prepare('SELECT loot_chunks FROM solo_world').get()?.['loot_chunks']).toBe('[]');
    raw.close();
});

test.each([
    { registry: '["0,-1","0,-1"]', change: 'none' },
    { registry: '["00,-1"]', change: 'none' },
    { registry: '["0,0"]', change: 'none' },
    { registry: '["1000001,0"]', change: 'none' },
    { registry: '["0,-1"]', change: 'missing' },
    { registry: '[]', change: 'extra' },
    { registry: '["0,-1"]', change: 'wrong-kind' },
])(
    'corrupt generated manifest is rejected without regeneration: $registry / $change',
    ({ registry, change }) => {
        const { path, store } = create();
        const locations = [...store.initialItemLocations, ...groundFor(0, -1)];
        store.saveItemLocations(locations);
        store.close();
        const database = new DatabaseSync(path);
        database.prepare('UPDATE solo_world SET loot_chunks = ?').run(registry);
        const altered = locations.map(location =>
            location.item.itemId.endsWith(':ammo') &&
            location.item.itemId.startsWith('chunk-loot-v1:') &&
            change === 'wrong-kind'
                ? { ...location, item: { ...location.item, kind: 'knife' } }
                : location,
        );
        if (change === 'missing') altered.pop();
        database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(altered));
        database.close();
        const bytes = readFileSync(path);
        expect(() => open(path)).toThrow();
        expect(readFileSync(path)).toEqual(bytes);
    },
);

test('registering a partial chunk cannot save half its loot or duplicate a base-layer weapon', () => {
    const { store } = create();
    expect(() => {
        store.saveItemLocations([...store.initialItemLocations, ...groundFor(0, -1).slice(0, 1)]);
    }).toThrow();
    const ammo = groundFor(1, 0)[0];
    if (ammo === undefined) throw new Error('Missing fixture ammo');
    expect(() => {
        store.saveItemLocations([
            ...store.initialItemLocations,
            ammo,
            {
                type: 'ground',
                item: {
                    itemId: 'chunk-loot-v1:1:0:weapon',
                    kind: 'knife',
                    position: { xMeters: 54, yMeters: -8 },
                },
            },
        ]);
    }).toThrow();
});

test('generated pistol metadata survives death and respawn; expiry removes only loot left in the body', () => {
    const { path, store } = create();
    const playerId = store.initialWorld.playerId;
    const diedAtMs = Date.now();
    const corpse = {
        corpseId: 'chunk-loot-death',
        playerId,
        diedAtMs,
        expiresAtMs: diedAtMs + 24 * 60 * 60 * 1000,
        position: { xMeters: -74, yMeters: 56 },
    };
    const locations: readonly ItemLocation[] = [
        ...store.initialItemLocations,
        ...groundFor(-1, 1),
    ].map(location => {
        if (location.item.itemId === 'chunk-loot-v1:-1:1:weapon')
            return {
                type: 'corpse',
                corpseId: corpse.corpseId,
                item: {
                    itemId: location.item.itemId,
                    kind: 'pistol',
                    rounds: 2,
                    magazineCapacity: 8,
                    revision: 4,
                },
            };
        const isNewAmmo = location.item.itemId === 'chunk-loot-v1:-1:1:ammo';
        const isOwned = location.type === 'hands' || location.type === 'container';
        if (isNewAmmo || isOwned)
            return { type: 'corpse', corpseId: corpse.corpseId, item: copyItem(location.item) };
        return location;
    });
    store.saveCombat(
        { health: 0, cooldownTicks: 0, bleedingTicks: 0 },
        locations,
        corpse.position,
        [corpse],
    );
    store.close();
    const dead = open(path);
    expect(dead.initialCorpses).toHaveLength(1);
    expect(dead.saveRespawn(0, { xMeters: 0, yMeters: 0 }).lifeRevision).toBe(1);
    dead.saveItemLocations(
        dead.initialItemLocations.map(location =>
            location.item.itemId === 'chunk-loot-v1:-1:1:ammo'
                ? {
                      type: 'container',
                      playerId,
                      item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity: 3 },
                      cell: { column: 0, row: 0 },
                  }
                : location,
        ),
    );
    dead.close();
    const expired = new SoloWorldStore(path, () => corpse.expiresAtMs + 1);
    try {
        expect(expired.initialCorpses).toEqual([]);
        expect(expired.initialCombat).toMatchObject({ health: 100, lifeRevision: 1 });
        expect(
            expired.initialItemLocations.filter(location => location.type === 'expired'),
        ).toHaveLength(5);
        expect(
            expired.initialItemLocations.find(
                location => location.item.itemId === 'chunk-loot-v1:-1:1:weapon',
            ),
        ).toMatchObject({ type: 'expired', item: { rounds: 2, revision: 4 } });
        expect(
            expired.initialItemLocations.find(
                location => location.item.itemId === 'chunk-loot-v1:-1:1:ammo',
            ),
        ).toMatchObject({ type: 'container', item: { quantity: 3 } });
    } finally {
        expired.close();
    }
});

test('a failed v12 migration rolls back the new column and leaves the entire old save unchanged', () => {
    const { path, store } = create();
    store.close();
    const database = new DatabaseSync(path);
    database.exec(
        "ALTER TABLE solo_world DROP COLUMN loot_chunks; PRAGMA user_version = 12; UPDATE solo_world SET corpses = '[{}]'",
    );
    database.close();
    const bytes = readFileSync(path);
    expect(() => open(path)).toThrow();
    expect(readFileSync(path)).toEqual(bytes);
    const restored = new DatabaseSync(path);
    expect(restored.prepare('PRAGMA user_version').get()?.['user_version']).toBe(12);
    expect(
        restored
            .prepare('PRAGMA table_info(solo_world)')
            .all()
            .some(column => column['name'] === 'loot_chunks'),
    ).toBe(false);
    restored.close();
});
