import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { workshopCrate } from '@zombi-survive/content';
import { copyItem, type ItemLocation, type WorldPosition } from '@zombi-survive/domain';
import { protocolVersion } from '@zombi-survive/protocol';
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
