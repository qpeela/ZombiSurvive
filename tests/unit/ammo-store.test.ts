import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type ItemLocation } from '@zombi-survive/domain';
import { reloadPistol } from '@zombi-survive/simulation';
import { generateWorldAmmoLoot } from '@zombi-survive/worldgen';
import { afterEach, expect, test } from 'vitest';

import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});
const create = () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-ammo-store-'));
    cleanups.push(() => {
        rmSync(directory, { recursive: true, force: true });
    });
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    cleanups.unshift(() => {
        store.close();
    });
    return { path, store };
};
const open = (path: string) => {
    const store = new SoloWorldStore(path);
    cleanups.unshift(() => {
        store.close();
    });
    return store;
};
const equip = (store: SoloWorldStore, rounds = 3, quantity = 8): readonly ItemLocation[] => {
    const playerId = store.initialWorld.playerId;
    return store.initialItemLocations.map(location => {
        if (location.item.itemId === 'pistol-v1:0:0')
            return {
                type: 'hands',
                playerId,
                item: { itemId: location.item.itemId, kind: 'pistol', rounds, magazineCapacity: 8 },
            };
        if (location.item.itemId === 'ammo9mm-v1:0:0')
            return {
                type: 'container',
                playerId,
                item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity },
                cell: { column: 0, row: 0 },
            };
        // Free room/weight for this test while retaining the finite identity manifest.
        if (location.type === 'container') return { type: 'expired', item: location.item };
        return location;
    });
};
test('the ammo overlay is deterministic, finite and separate from melee/gun identity', () => {
    for (const seed of ['initial', 'other']) {
        const ammo = generateWorldAmmoLoot(seed);
        expect(ammo).toEqual(generateWorldAmmoLoot(seed));
        expect(ammo).toHaveLength(1);
        expect(ammo[0]).toMatchObject({ itemId: 'ammo9mm-v1:0:0', kind: 'ammo9mm', quantity: 8 });
    }
});
test('v10 adds ammo exactly once without changing a partial pistol or profile', () => {
    const { path, store } = create();
    store.saveDisplayName('Перезаряжающий');
    const old = store.initialItemLocations
        .filter(
            location =>
                location.item.kind !== 'ammo9mm' && !location.item.itemId.startsWith('scatter-v1:'),
        )
        .map(location =>
            location.type === 'ground' &&
            location.item.itemId === 'pistol-v1:0:0' &&
            location.item.kind === 'pistol'
                ? { ...location, item: { ...location.item, rounds: 2, revision: 4 } }
                : location,
        );
    const world = store.initialWorld;
    store.close();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(old));
    database.exec('ALTER TABLE solo_world DROP COLUMN loot_chunks; PRAGMA user_version = 10');
    database.close();
    let loaded = open(path);
    expect(loaded.initialWorld.worldId).toBe(world.worldId);
    expect(loaded.initialWorld.displayName).toBe('Перезаряжающий');
    expect(
        loaded.initialItemLocations.find(
            location => location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
        )?.item,
    ).toMatchObject({ rounds: 2, revision: 4 });
    expect(
        loaded.initialItemLocations.filter(location => location.item.itemId === 'ammo9mm-v1:0:0'),
    ).toHaveLength(1);
    loaded.close();
    loaded = open(path);
    expect(
        loaded.initialItemLocations.filter(location => location.item.itemId === 'ammo9mm-v1:0:0'),
    ).toHaveLength(1);
});
test('partial and consumed packs survive reload/restart without ever respawning', () => {
    const { path, store } = create();
    const playerId = store.initialWorld.playerId;
    const source = equip(store);
    store.saveItemLocations(source);
    const gun = source.find(
        location => location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
    );
    if (gun === undefined) throw new Error('Missing gun');
    store.saveItemLocations(
        reloadPistol({ locations: source, playerId, itemId: gun.item.itemId, revision: 0 }),
    );
    store.close();
    let loaded = open(path);
    expect(
        loaded.initialItemLocations.find(
            location =>
                location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
        ),
    ).toMatchObject({ type: 'container', item: { quantity: 3 } });
    const next = loaded.initialItemLocations.map(location =>
        location.type === 'hands' &&
        location.item.itemId === 'pistol-v1:0:0' &&
        location.item.kind === 'pistol'
            ? { ...location, item: { ...location.item, rounds: 0 } }
            : location,
    );
    loaded.saveItemLocations(
        reloadPistol({ locations: next, playerId, itemId: gun.item.itemId, revision: 1 }),
    );
    loaded.close();
    loaded = open(path);
    expect(
        loaded.initialItemLocations.find(
            location => location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
        ),
    ).toMatchObject({ type: 'hands', item: { rounds: 3, revision: 2 } });
    expect(
        loaded.initialItemLocations.find(
            location =>
                location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
        ),
    ).toMatchObject({ type: 'consumed', item: { quantity: 0 } });
    loaded.close();
    loaded = open(path);
    expect(
        loaded.initialItemLocations.find(
            location =>
                location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
        )?.type,
    ).toBe('consumed');
});
test('zero stacks exist only as consumed markers; wrong kind, hands and malformed quantities fail closed', () => {
    const { store } = create();
    const source = store.initialItemLocations;
    for (const quantity of [-1, 0, 0.5, 9, Infinity, NaN]) {
        const next = source.map(location =>
            location.type === 'ground' &&
            location.item.itemId === 'ammo9mm-v1:0:0' &&
            location.item.kind === 'ammo9mm'
                ? { ...location, item: { ...location.item, quantity } }
                : location,
        );
        expect(() => {
            store.saveItemLocations(next);
        }).toThrow();
    }
    const inHands = source.map(location =>
        location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm'
            ? {
                  type: 'hands' as const,
                  playerId: store.initialWorld.playerId,
                  item: { itemId: location.item.itemId, kind: 'ammo9mm' as const, quantity: 8 },
              }
            : location,
    );
    expect(() => {
        store.saveItemLocations(inHands);
    }).toThrow();
    const malformed: readonly ItemLocation[] = source.map(location =>
        location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol'
            ? {
                  type: 'consumed',
                  item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity: 0 },
              }
            : location,
    );
    expect(() => {
        store.saveItemLocations(malformed);
    }).toThrow();
});
test('failed ammo migration rolls back the complete v10 file', () => {
    const { path, store } = create();
    const old = store.initialItemLocations.filter(
        location =>
            location.item.kind !== 'ammo9mm' && !location.item.itemId.startsWith('scatter-v1:'),
    );
    store.close();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(old));
    database.exec(
        "ALTER TABLE solo_world DROP COLUMN loot_chunks; PRAGMA user_version = 10; CREATE TRIGGER reject_ammo BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'fixture ammo migration failure'); END",
    );
    database.close();
    const before = readFileSync(path);
    expect(() => new SoloWorldStore(path)).toThrow(/fixture ammo migration failure/);
    expect(readFileSync(path)).toEqual(before);
});
test('ammo state travels into a body and expired packs retain quantity and cannot be regranted', () => {
    const { path, store } = create();
    const owned = equip(store, 0, 3);
    const corpse = {
        corpseId: 'ammo-body',
        playerId: store.initialWorld.playerId,
        position: { xMeters: 0, yMeters: 0 },
        diedAtMs: 1,
        expiresAtMs: 1 + 24 * 60 * 60 * 1000,
    };
    const dead = owned.map(location =>
        location.type === 'hands' || location.type === 'container'
            ? { type: 'corpse' as const, corpseId: corpse.corpseId, item: location.item }
            : location,
    );
    store.saveCombat({ health: 0, cooldownTicks: 0, bleedingTicks: 0 }, dead, corpse.position, [
        corpse,
    ]);
    store.close();
    const loaded = open(path);
    expect(loaded.initialCorpses).toHaveLength(0);
    expect(
        loaded.initialItemLocations.find(
            location =>
                location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
        ),
    ).toMatchObject({ type: 'expired', item: { quantity: 3 } });
});
