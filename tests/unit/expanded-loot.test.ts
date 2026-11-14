import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { collisionSettings, worldGenerationSettings } from '@zombi-survive/content';
import { copyItem, type ItemLocation, type ZombieState } from '@zombi-survive/domain';
import { movementStepSeconds, stepGunshotInvestigation } from '@zombi-survive/simulation';
import {
    generateExpandedLoot,
    generateWorldChunk,
    generateWorldWeaponLoot,
    initialExpandedLoot,
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
    const directory = mkdtempSync(join(tmpdir(), 'zombi-expanded-'));
    cleanups.push(() => {
        rmSync(directory, { recursive: true, force: true });
    });
    const path = join(directory, 'world.sqlite');
    return { path, store: open(path) };
};
const stripExpanded = (path: string, locations: readonly ItemLocation[]) => {
    const database = new DatabaseSync(path);
    database
        .prepare('UPDATE solo_world SET item_location = ?')
        .run(
            JSON.stringify(
                locations.filter(location => !location.item.itemId.startsWith('scatter-v1:')),
            ),
        );
    database.exec('PRAGMA user_version = 11');
    database.close();
};

test('six additional weapons and two ammo packs are deterministic, distinct and distributed in all directions', () => {
    for (let seed = 0; seed < 25; seed++) {
        const name = `loot-${String(seed)}`;
        const original = generateWorldWeaponLoot(name);
        const loot = generateExpandedLoot(name);
        expect(loot).toEqual(generateExpandedLoot(name));
        expect(loot).toHaveLength(8);
        expect(new Set(loot.map(item => item.itemId)).size).toBe(8);
        expect(loot.filter(item => item.kind === 'pistol')).toHaveLength(2);
        expect(loot.filter(item => item.kind === 'ammo9mm')).toHaveLength(2);
        expect(generateWorldWeaponLoot(name)).toEqual(original);
        expect(loot.some(item => item.position.xMeters < -10)).toBe(true);
        expect(loot.some(item => item.position.xMeters > 10)).toBe(true);
        expect(loot.some(item => item.position.yMeters < -10)).toBe(true);
        expect(loot.some(item => item.position.yMeters > 10)).toBe(true);
        const chunk = generateWorldChunk({ seed: name, generatorVersion: 1, chunkX: 0, chunkY: 0 });
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
        }
    }
});
test('all new sites can be approached from the start with the existing navigation and collider footprint', () => {
    const obstacles = generateWorldChunk({
        seed: worldGenerationSettings.initialSeed,
        generatorVersion: 1,
        chunkX: 0,
        chunkY: 0,
    }).obstacles;
    for (const item of initialExpandedLoot.filter(item => item.kind !== 'ammo9mm')) {
        let zombie: ZombieState = {
            zombieId: 'route-probe',
            targetPlayerId: null,
            position: { xMeters: 0, yMeters: 0 },
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
});
test('v11 migration adds only the new IDs once while preserving collected magazine, ammo, health and profile', () => {
    const { path, store } = create();
    const playerId = store.initialWorld.playerId;
    const owned = store.initialItemLocations.map((location): ItemLocation => {
        if (location.item.itemId === 'pistol-v1:0:0')
            return {
                type: 'hands',
                playerId,
                item: {
                    itemId: location.item.itemId,
                    kind: 'pistol',
                    magazineCapacity: 8,
                    rounds: 2,
                    revision: 4,
                },
            };
        if (location.item.itemId === 'ammo9mm-v1:0:0')
            return {
                type: 'container',
                playerId,
                item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity: 3 },
                cell: { column: 0, row: 0 },
            };
        return location;
    });
    store.saveItemLocations(owned);
    store.saveDisplayName('Исследователь');
    store.saveCombat({ health: 73, bleedingTicks: 0, cooldownTicks: 0, lifeRevision: 2 });
    store.close();
    stripExpanded(path, owned);
    let loaded = open(path);
    expect(loaded.initialItemLocations).toHaveLength(19);
    expect(
        loaded.initialItemLocations.filter(location =>
            location.item.itemId.startsWith('scatter-v1:'),
        ),
    ).toHaveLength(8);
    expect(
        loaded.initialItemLocations.find(location => location.item.itemId === 'pistol-v1:0:0'),
    ).toMatchObject({ type: 'hands', item: { rounds: 2, revision: 4 } });
    expect(
        loaded.initialItemLocations.find(location => location.item.itemId === 'ammo9mm-v1:0:0'),
    ).toMatchObject({ type: 'container', item: { quantity: 3 } });
    expect(loaded.initialCombat.health).toBe(73);
    expect(loaded.initialWorld.displayName).toBe('Исследователь');
    loaded.close();
    loaded = open(path);
    expect(new Set(loaded.initialItemLocations.map(location => location.item.itemId)).size).toBe(
        19,
    );
});
test('collected extra gun/pack state and tombstones survive restart without generating replacements', () => {
    const { path, store } = create();
    const playerId = store.initialWorld.playerId;
    const gunId = 'scatter-v1:pistol:west';
    const ammoId = `${gunId}:ammo`;
    const locations = store.initialItemLocations.map((location): ItemLocation => {
        if (location.item.itemId === `${playerId}:axe`)
            return { type: 'expired', item: location.item };
        if (location.item.itemId === gunId)
            return {
                type: 'container',
                playerId,
                item: {
                    itemId: gunId,
                    kind: 'pistol',
                    rounds: 5,
                    magazineCapacity: 8,
                    revision: 2,
                },
                cell: { column: 0, row: 2 },
            };
        if (location.item.itemId === ammoId)
            return {
                type: 'container',
                playerId,
                item: { itemId: ammoId, kind: 'ammo9mm', quantity: 3 },
                cell: { column: 2, row: 0 },
            };
        return location;
    });
    store.saveItemLocations(locations);
    store.close();
    let loaded = open(path);
    expect(
        loaded.initialItemLocations.find(location => location.item.itemId === gunId),
    ).toMatchObject({ type: 'container', item: { rounds: 5, revision: 2 } });
    loaded.saveItemLocations(
        loaded.initialItemLocations.map((location): ItemLocation => {
            if (location.item.itemId === gunId)
                return { type: 'expired', item: copyItem(location.item) };
            if (location.item.itemId === ammoId)
                return { type: 'consumed', item: { itemId: ammoId, kind: 'ammo9mm', quantity: 0 } };
            return location;
        }),
    );
    loaded.close();
    loaded = open(path);
    expect(
        loaded.initialItemLocations.find(location => location.item.itemId === gunId),
    ).toMatchObject({ type: 'expired', item: { rounds: 5 } });
    expect(
        loaded.initialItemLocations.find(location => location.item.itemId === ammoId),
    ).toMatchObject({ type: 'consumed' });
    expect(loaded.initialItemLocations).toHaveLength(19);
});
test('v11 migration failure rolls back the file, and v12 rejects missing/duplicate extra identities', () => {
    const { path, store } = create();
    const source = store.initialItemLocations;
    expect(() => {
        store.saveItemLocations(
            source.filter(location => location.item.itemId !== initialExpandedLoot[0]?.itemId),
        );
    }).toThrow();
    const first = initialExpandedLoot[0];
    if (first === undefined) throw new Error('Missing new loot');
    expect(() => {
        store.saveItemLocations([...source, { type: 'ground', item: first }]);
    }).toThrow();
    store.close();
    stripExpanded(path, source);
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_scatter BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'fixture scatter migration failure'); END",
    );
    database.close();
    const before = readFileSync(path);
    expect(() => new SoloWorldStore(path)).toThrow(/fixture scatter migration failure/);
    expect(readFileSync(path)).toEqual(before);
});
