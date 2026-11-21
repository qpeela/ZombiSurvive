import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { corpseSettings, workshopCrate } from '@zombi-survive/content';
import { copyItem, type ItemLocation, type WorldPosition } from '@zombi-survive/domain';
import { inventoryVersion, protocolVersion } from '@zombi-survive/protocol';
import { findInventorySpace, playerInventory } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';
import { createMovementSnapshot } from '../../apps/server/src/movement-contract.ts';
import {
    chunkLootForKey,
    initialChunkLootLocation,
} from '../../apps/server/src/saved-chunk-loot.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

const stock = initialChunkLootLocation(workshopCrate.stock);
const playerId = 'solo';
const near = { xMeters: -60.25, yMeters: 0 };
const behindWall = { xMeters: -58.1, yMeters: 0 };
const outOfReach = { xMeters: -62, yMeters: 0 };
const movement = (position: WorldPosition) =>
    createMovementSnapshot(
        'world',
        1,
        {
            playerId,
            position,
            stamina: 1,
            isExhausted: false,
            isSneaking: false,
            noiseRadiusMeters: 0,
        },
        null,
    );

const pickUp = (pickup: LocalWorldPickup, position: WorldPosition): void => {
    pickup.receive('session', { type: 'pickup-item', protocolVersion, itemId: stock.item.itemId });
    pickup.step(new Map([['session', movement(position)]]));
};

test('crate pickup respects the wall, distance and backpack space and commits only one transfer', () => {
    const pickup = new LocalWorldPickup([stock]);
    expect(pickup.snapshot(movement(behindWall)).storage).toBeUndefined();
    expect(pickup.snapshot(movement(outOfReach)).storage?.items).toEqual([stock.item]);
    pickUp(pickup, behindWall);
    pickUp(pickup, outOfReach);
    expect(pickup.takePendingSave()).toBeNull();

    const occupied: ItemLocation[] = [0, 1, 2].flatMap(row =>
        [0, 2].map(column => ({
            type: 'container',
            playerId,
            cell: { row, column },
            item: { itemId: `ammo-${String(row)}-${String(column)}`, kind: 'ammo9mm', quantity: 1 },
        })),
    );
    const full = new LocalWorldPickup([stock, ...occupied]);
    pickUp(full, near);
    expect(full.takePendingSave()).toBeNull();
    expect(full.snapshot(movement(near)).storage?.items).toEqual([stock.item]);

    pickUp(pickup, near);
    expect(pickup.snapshot(movement(near)).storage?.items).toEqual([stock.item]);
    expect(pickup.takePendingSave()).toEqual([
        {
            type: 'container',
            playerId,
            cell: { column: 0, row: 0 },
            item: stock.item,
        },
    ]);
    pickup.confirmSave();
    pickUp(pickup, near);
    expect(pickup.takePendingSave()).toBeNull();
    expect(pickup.snapshot(movement(near)).storage?.items).toEqual([]);
});

test('an already visited workshop gains one crate supply on migration and retains its new location', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-crate-migration-'));
    const path = join(directory, 'world.sqlite');
    let store = new SoloWorldStore(path);
    try {
        const { playerId: owner } = store.initialWorld;
        const oldLocations = [
            ...store.initialItemLocations,
            ...chunkLootForKey('-1,0')
                .filter(item => item.itemId !== stock.item.itemId)
                .map(initialChunkLootLocation),
        ];
        store.close();

        const database = new DatabaseSync(path);
        try {
            database
                .prepare('UPDATE solo_world SET loot_chunks = ?, item_location = ? WHERE id = 1')
                .run(JSON.stringify(['-1,0']), JSON.stringify(oldLocations));
            database.exec('PRAGMA user_version = 22');
        } finally {
            database.close();
        }

        store = new SoloWorldStore(path);
        const migrated = store.initialItemLocations;
        expect(migrated.filter(location => location.item.itemId === stock.item.itemId)).toEqual([
            stock,
        ]);
        const cell = findInventorySpace({
            items: playerInventory(migrated, owner),
            item: stock.item,
        });
        if (cell === null) throw new Error('Expected room for the crate supply.');

        const carried: ItemLocation = {
            type: 'container',
            playerId: owner,
            cell,
            item: copyItem(stock.item),
        };
        store.saveItemLocations(
            migrated.map(location =>
                location.item.itemId === stock.item.itemId ? carried : location,
            ),
        );
        store.close();
        store = new SoloWorldStore(path);
        expect(
            store.initialItemLocations.filter(
                location => location.item.itemId === stock.item.itemId,
            ),
        ).toEqual([carried]);
    } finally {
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a crate rejects deposits beyond its capacity, through walls, or by a dead or different owner', () => {
    const bandage: ItemLocation = {
        type: 'container',
        playerId,
        cell: { column: 0, row: 0 },
        item: { itemId: 'carried-bandage', kind: 'bandage' },
    };
    const extraStock: ItemLocation[] = Array.from(
        { length: workshopCrate.capacity - 1 },
        (_, index) => ({
            type: 'storage',
            storageId: workshopCrate.id,
            item: { itemId: 'stock-' + String(index), kind: 'bandage' },
        }),
    );
    const receive = (pickup: LocalWorldPickup) => {
        pickup.receiveStoreItem('session', {
            type: 'store-item',
            itemId: bandage.item.itemId,
            protocolVersion,
            inventoryVersion,
            storageId: workshopCrate.id,
        });
    };
    const full = new LocalWorldPickup([stock, bandage, ...extraStock]);
    receive(full);
    full.step(new Map([['session', movement(near)]]));
    expect(full.takePendingSave()).toBeNull();

    const available = new LocalWorldPickup([stock, bandage]);
    for (const position of [behindWall, outOfReach]) {
        receive(available);
        available.step(new Map([['session', movement(position)]]));
        expect(available.takePendingSave()).toBeNull();
    }
    receive(available);
    available.step(new Map([['session', movement(near)]]), () => 0);
    expect(available.takePendingSave()).toBeNull();

    const other = movement(near);
    receive(available);
    available.step(
        new Map([['session', { ...other, player: { ...other.player, playerId: 'other' } }]]),
    );
    expect(available.takePendingSave()).toBeNull();

    receive(available);
    available.step(new Map([['session', movement(near)]]));
    expect(available.snapshot(movement(near)).items).toHaveLength(1);
    expect(available.takePendingSave()).toEqual([
        stock,
        { type: 'storage', storageId: workshopCrate.id, item: bandage.item },
    ]);
    available.confirmSave();
    receive(available);
    available.step(new Map([['session', movement(near)]]));
    expect(available.takePendingSave()).toBeNull();
    expect(available.snapshot(movement(near)).items).toHaveLength(0);
    expect(available.snapshot(movement(near)).storage?.items).toEqual([stock.item, bandage.item]);
});

test('a stored pistol keeps its instance and magazine through death, restart and retrieval', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-crate-death-'));
    const path = join(directory, 'world.sqlite');
    let store = new SoloWorldStore(path);
    try {
        const { playerId: owner } = store.initialWorld;
        const pistol = store.initialItemLocations.find(location => location.item.kind === 'pistol');
        if (pistol?.item.kind !== 'pistol') throw new Error('Expected the starter world pistol.');

        const { itemId, kind, magazineCapacity } = pistol.item;
        const weapon = { itemId, kind, magazineCapacity, rounds: 3, revision: 9 };
        const stored: ItemLocation = { type: 'storage', storageId: workshopCrate.id, item: weapon };
        const locations = [
            ...store.initialItemLocations.map(location =>
                location.item.itemId === weapon.itemId ? stored : location,
            ),
            ...chunkLootForKey('-1,0').map(initialChunkLootLocation),
        ];
        store.saveItemLocations(locations);

        const pickup = new LocalWorldPickup(locations);
        const diedAtMs = Date.now();
        const corpse = {
            corpseId: 'player-corpse',
            playerId: owner,
            position: near,
            diedAtMs,
            expiresAtMs: diedAtMs + corpseSettings.lifetimeMs,
        };
        pickup.stageDeath(corpse);
        const pending = pickup.takePendingSave();
        if (pending === null) throw new Error('Expected an atomic death save.');
        store.saveCombat({ health: 0, cooldownTicks: 0, bleedingTicks: 0 }, pending, near, [
            corpse,
        ]);
        store.close();

        store = new SoloWorldStore(path);
        expect(store.initialCombat.health).toBe(0);
        expect(
            store.initialItemLocations.filter(location => location.item.itemId === weapon.itemId),
        ).toEqual([stored]);

        const respawned = store.saveRespawn(store.initialCombat.lifeRevision ?? 0, near);
        const returned = new LocalWorldPickup(store.initialItemLocations);
        const state = movement(near);
        returned.receive('returning', {
            type: 'pickup-item',
            protocolVersion,
            itemId: weapon.itemId,
        });
        returned.step(
            new Map([['returning', { ...state, player: { ...state.player, playerId: owner } }]]),
            () => respawned.health,
        );
        const retrieved = returned
            .takePendingSave()
            ?.find(location => location.item.itemId === weapon.itemId);
        expect(retrieved).toMatchObject({ type: 'container', playerId: owner, item: weapon });
    } finally {
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
