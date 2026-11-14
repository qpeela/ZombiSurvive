import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { pistolSettings } from '@zombi-survive/content';
import { copyItem, type Corpse, type ItemLocation, type PistolItem } from '@zombi-survive/domain';
import { isMeleeSnapshot, isPickupSnapshot } from '@zombi-survive/protocol';
import {
    addStarterWeapons,
    pickUpItem,
    placeInventoryItem,
    playerHands,
    playerInventory,
    transferWeapon,
} from '@zombi-survive/simulation';
import { generateWorldPistolLoot, initialWorldPistolLoot } from '@zombi-survive/worldgen';
import { afterEach, expect, test } from 'vitest';

import { LocalWorldMelee } from '../../apps/server/src/local-world-melee.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { removePistolForLegacySave } from './legacy-save-fixture.ts';

const pistol: PistolItem = {
    itemId: 'pistol-v1:0:0',
    kind: 'pistol',
    rounds: 3,
    magazineCapacity: 8,
};
const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});
const pathForTest = () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-pistol-'));
    directories.push(directory);
    return join(directory, 'world.sqlite');
};

test('rare pistol overlay is deterministic and leaves the existing item identity finite', () => {
    for (const seed of ['initial', 'another', 'three']) {
        const loot = generateWorldPistolLoot(seed);
        expect(loot).toHaveLength(1);
        expect(loot).toEqual(generateWorldPistolLoot(seed));
        expect(loot[0]).toMatchObject({
            itemId: pistol.itemId,
            kind: 'pistol',
            rounds: 8,
            magazineCapacity: 8,
        });
    }
    expect(initialWorldPistolLoot).toHaveLength(1);
    expect(pistolSettings).toMatchObject({
        damage: 30,
        rangeMeters: 20,
        cooldownTicks: 10,
        magazineCapacity: 8,
    });
});

test('ground pickup, inventory moves, hands and swaps preserve magazine state and strip coordinates', () => {
    const ground: ItemLocation = {
        type: 'ground',
        item: { ...pistol, position: { xMeters: 0, yMeters: 0 } },
    };
    const movement = new LocalWorldMovement('world', 'player');
    movement.join('tab');
    const player = movement.snapshot('tab').player;
    const picked = pickUpItem({ location: ground, player, itemId: pistol.itemId, obstacles: [] });
    expect(picked).toMatchObject({ type: 'container', item: pistol });
    expect(copyItem(ground.item)).toEqual(pistol);
    const moved = placeInventoryItem({ items: [], item: pistol, cell: { column: 2, row: 2 } });
    expect(moved).toEqual([{ ...pistol, cell: { column: 2, row: 2 } }]);
    let locations = transferWeapon({
        locations: [picked],
        playerId: 'player',
        itemId: pistol.itemId,
        type: 'equip-weapon',
    });
    expect(playerHands(locations, 'player')).toEqual(pistol);
    locations = transferWeapon({
        locations,
        playerId: 'player',
        itemId: pistol.itemId,
        type: 'unequip-weapon',
    });
    expect(playerInventory(locations, 'player')).toEqual([
        { ...pistol, cell: { column: 0, row: 0 } },
    ]);
    expect(
        transferWeapon({
            locations,
            playerId: 'foreign',
            itemId: pistol.itemId,
            type: 'equip-weapon',
        }),
    ).toBe(locations);
});

test('pistol pickup respects capacity and becomes possible after moving heavy gear to hands', () => {
    let locations = addStarterWeapons([], 'player');
    const ground: ItemLocation = {
        type: 'ground',
        item: { ...pistol, position: { xMeters: 0, yMeters: 0 } },
    };
    const movement = new LocalWorldMovement('world', 'player');
    movement.join('tab');
    const player = movement.snapshot('tab').player;
    expect(
        pickUpItem({
            location: ground,
            player,
            itemId: pistol.itemId,
            obstacles: [],
            items: playerInventory(locations, 'player'),
        }),
    ).toBe(ground);
    locations = transferWeapon({
        locations,
        playerId: 'player',
        itemId: 'player:axe',
        type: 'equip-weapon',
    });
    expect(
        pickUpItem({
            location: ground,
            player,
            itemId: pistol.itemId,
            obstacles: [],
            items: playerInventory(locations, 'player'),
        }),
    ).toMatchObject({ type: 'container', item: pistol });
});

test('wire state validates pistol instance magazine and equipment cannot perform a melee swing', () => {
    const movement = new LocalWorldMovement('world', 'player');
    movement.join('tab');
    const snapshot = movement.snapshot('tab');
    const pickup = new LocalWorldPickup([{ type: 'hands', playerId: 'player', item: pistol }]);
    expect(isPickupSnapshot(pickup.snapshot(snapshot))).toBe(true);
    for (const fields of [
        { rounds: -1 },
        { rounds: 9 },
        { rounds: 0.5 },
        { magazineCapacity: 0 },
        { rounds: undefined },
        { magazineCapacity: undefined },
    ])
        expect(
            isPickupSnapshot({ ...pickup.snapshot(snapshot), hands: { ...pistol, ...fields } }),
        ).toBe(false);
    const melee = new LocalWorldMelee(state => pickup.weapon(state));
    melee.receive('tab', { type: 'melee-attack', protocolVersion: 5, meleeVersion: 3 });
    melee.step({
        snapshots: new Map([['tab', snapshot]]),
        zombies: [],
        obstacles: [],
        health: () => 100,
        damage: () => null,
    });
    expect(melee.action(snapshot)).toBeNull();
    expect(melee.snapshot(snapshot).weapon).toBe('pistol');
    expect(isMeleeSnapshot(melee.snapshot(snapshot))).toBe(true);
    expect(pickup.snapshot(snapshot).hands).toEqual(pistol);
});

test('v9 adds one pistol once, preserving existing health/profile and later saved empty magazine', () => {
    const path = pathForTest();
    let store = new SoloWorldStore(path);
    store.saveDisplayName('Стрелок');
    store.saveCombat({ health: 77, cooldownTicks: 0, bleedingTicks: 0, lifeRevision: 2 });
    const world = store.initialWorld;
    store.close();
    const legacy = new DatabaseSync(path);
    removePistolForLegacySave(legacy);
    legacy.exec('ALTER TABLE solo_world DROP COLUMN loot_chunks; PRAGMA user_version = 9');
    legacy.close();
    store = new SoloWorldStore(path);
    expect(
        store.initialItemLocations.filter(
            location => location.item.itemId === pistol.itemId && location.item.kind === 'pistol',
        ),
    ).toHaveLength(1);
    expect(store.initialWorld.playerId).toBe(world.playerId);
    expect(store.initialWorld.displayName).toBe('Стрелок');
    expect(store.initialCombat).toEqual({
        health: 77,
        cooldownTicks: 0,
        bleedingTicks: 0,
        lifeRevision: 2,
    });
    store.saveItemLocations(
        store.initialItemLocations.map(location =>
            location.type === 'ground' &&
            location.item.itemId === pistol.itemId &&
            location.item.kind === 'pistol'
                ? { type: 'ground', item: { ...location.item, rounds: 0 } }
                : location,
        ),
    );
    store.close();
    for (let count = 0; count < 2; count++) {
        store = new SoloWorldStore(path);
        const pistols = store.initialItemLocations.filter(
            location => location.item.itemId === pistol.itemId,
        );
        expect(pistols).toHaveLength(1);
        expect(pistols[0]).toMatchObject({ item: { rounds: 0, magazineCapacity: 8 } });
        store.close();
    }
});

test('death, empty-handed respawn and recovered pistol keep the same instance and partial magazine', () => {
    const path = pathForTest();
    let store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    const diedAtMs = Date.now();
    const body: Corpse = {
        corpseId: 'pistol-life',
        playerId,
        diedAtMs,
        expiresAtMs: diedAtMs + 24 * 60 * 60 * 1000,
        position: { xMeters: 0, yMeters: 0 },
    };
    const held = store.initialItemLocations.map(location =>
        location.item.itemId === pistol.itemId && location.item.kind === 'pistol'
            ? { type: 'hands' as const, playerId, item: pistol }
            : location,
    );
    const pickup = new LocalWorldPickup(held);
    pickup.stageDeath(body);
    const pending = pickup.takePendingSave();
    if (pending === null) throw new Error('Missing death items');
    store.saveCombat({ health: 0, cooldownTicks: 0, bleedingTicks: 0 }, pending, body.position, [
        body,
    ]);
    store.saveRespawn(0, body.position);
    store.close();
    store = new SoloWorldStore(path);
    const movement = new LocalWorldMovement(store.initialWorld.worldId, playerId, body.position);
    movement.join('tab');
    const restored = new LocalWorldPickup(store.initialItemLocations, store.initialCorpses);
    restored.receive('tab', { type: 'pickup-item', protocolVersion: 5, itemId: pistol.itemId });
    restored.step(new Map([['tab', movement.snapshot('tab')]]));
    const recovered = restored.takePendingSave();
    if (recovered === null) throw new Error('Missing recovered pistol');
    store.saveItemLocations(recovered);
    restored.confirmSave();
    expect(restored.snapshot(movement.snapshot('tab')).items).toEqual([
        { ...pistol, cell: { column: 0, row: 0 } },
    ]);
    store.close();
});

test.each([
    { rounds: -1 },
    { rounds: 9 },
    { rounds: 1.5 },
    { rounds: null },
    { magazineCapacity: 9 },
    { magazineCapacity: undefined },
])('invalid persisted magazine %j fails closed', fields => {
    const path = pathForTest();
    const store = new SoloWorldStore(path);
    const locations = store.initialItemLocations.map(location =>
        location.item.itemId === pistol.itemId && location.item.kind === 'pistol'
            ? { ...location, item: { ...location.item, ...fields } }
            : location,
    );
    store.close();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(locations));
    database.close();
    const bytes = readFileSync(path);
    expect(() => new SoloWorldStore(path)).toThrow(/invalid item/);
    expect(readFileSync(path)).toEqual(bytes);
});

test('rejected pistol overlay migration rolls back old manifest and version together', () => {
    const path = pathForTest();
    new SoloWorldStore(path).close();
    const database = new DatabaseSync(path);
    removePistolForLegacySave(database);
    database.exec(
        "ALTER TABLE solo_world DROP COLUMN loot_chunks; PRAGMA user_version = 9; CREATE TRIGGER reject_pistol BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'pistol migration failure'); END",
    );
    database.close();
    const bytes = readFileSync(path);
    expect(() => new SoloWorldStore(path)).toThrow(/pistol migration failure/);
    expect(readFileSync(path)).toEqual(bytes);
});

test('expired pistol markers preserve the finite manifest and never produce replacement loot', () => {
    const path = pathForTest();
    let store = new SoloWorldStore(path);
    store.saveItemLocations(
        store.initialItemLocations.map(location =>
            location.item.itemId === pistol.itemId && location.item.kind === 'pistol'
                ? { type: 'expired', item: pistol }
                : location,
        ),
    );
    store.close();
    store = new SoloWorldStore(path);
    expect(
        store.initialItemLocations.find(location => location.item.itemId === pistol.itemId),
    ).toEqual({ type: 'expired', item: pistol });
    expect(
        store.initialItemLocations.filter(
            location => location.item.itemId === pistol.itemId && location.item.kind === 'pistol',
        ),
    ).toHaveLength(1);
    store.close();
});

test('saved pistol revisions are optional but must be safe nonnegative integers', () => {
    const store = new SoloWorldStore(pathForTest());
    try {
        for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => {
                store.saveItemLocations(
                    store.initialItemLocations.map(location =>
                        location.type === 'ground' &&
                        location.item.itemId === pistol.itemId &&
                        location.item.kind === 'pistol'
                            ? { ...location, item: { ...location.item, revision } }
                            : location,
                    ),
                );
            }).toThrow();
        }
        store.saveItemLocations(
            store.initialItemLocations.map(location =>
                location.type === 'ground' &&
                location.item.itemId === pistol.itemId &&
                location.item.kind === 'pistol'
                    ? { ...location, item: { ...location.item, revision: 3, rounds: 5 } }
                    : location,
            ),
        );
    } finally {
        store.close();
    }
});
