import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initialGroundItem } from '@zombi-survive/content';
import type { ItemLocation } from '@zombi-survive/domain';
import { addStarterWeapons } from '@zombi-survive/simulation';
import { initialWorldWeaponLoot } from '@zombi-survive/worldgen';
import { afterEach, expect, test } from 'vitest';

import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

const directories: string[] = [];
const stores: SoloWorldStore[] = [];
const createPath = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-save-unit-'));
    directories.push(directory);

    return join(directory, 'world.sqlite');
};
const open = (path: string): SoloWorldStore => {
    const store = new SoloWorldStore(path);
    stores.push(store);

    return store;
};

afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});

test.each([
    { xMeters: 64, yMeters: -64 },
    { xMeters: -96, yMeters: 96 },
    { xMeters: 4.65, yMeters: 0 },
])('disk round-trip retains IDs and exact position $xMeters, $yMeters', position => {
    const path = createPath();
    const first = open(path);
    const initial = first.initialWorld;
    expect(initial.position).toEqual({ xMeters: 0, yMeters: 0 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    first.savePosition(position);
    first.close();
    const restored = open(path);
    expect(restored.initialWorld).toEqual({ ...initial, position });
    restored.close();
    expect(open(createPath()).initialWorld.worldId).not.toBe(initial.worldId);
});

test('one host exclusively owns a save until close, then the next can load it', () => {
    const path = createPath();
    const first = open(path);
    expect(() => open(path)).toThrow(/locked/);
    first.savePosition({ xMeters: 0, yMeters: -10 });
    first.close();
    expect(open(path).initialWorld.position).toEqual({ xMeters: 0, yMeters: -10 });
});

test.each([
    'PRAGMA user_version = 8',
    "UPDATE solo_world SET seed = 'another-world'",
    'UPDATE solo_world SET generator_version = 2',
    "UPDATE solo_world SET player_id = 'bad'",
    "UPDATE solo_world SET world_id = 'bad'",
    'UPDATE solo_world SET x_meters = 1e999',
    'UPDATE solo_world SET x_meters = 64000064',
    'UPDATE solo_world SET x_meters = 5.25, y_meters = 0',
    'DELETE FROM solo_world',
    'PRAGMA user_version = 0',
    "UPDATE solo_world SET display_name = '<script>'",
    'UPDATE solo_world SET name_revision = -1',
])('incompatible or invalid data fails closed without replacing the save: %s', sql => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database.exec(sql);
    database.close();
    const bytes = readFileSync(path);
    expect(() => open(path)).toThrow();
    expect(readFileSync(path)).toEqual(bytes);
});

test('corrupt files and relative paths are rejected, never silently reset', () => {
    const path = createPath();
    writeFileSync(path, 'not a database');
    expect(() => open(path)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('not a database');
    expect(() => open('relative.sqlite')).toThrow(/absolute/);
});

test('a failed update is atomic and preserves the last committed position', () => {
    const path = createPath();
    const first = open(path);
    const position = { xMeters: 0, yMeters: -8 };
    first.savePosition(position);
    first.close();
    const database = new DatabaseSync(path);
    database.exec(`CREATE TRIGGER reject_save BEFORE UPDATE ON solo_world
        BEGIN SELECT RAISE(ABORT, 'test write failure'); END`);
    database.close();
    const next = open(path);
    expect(() => {
        next.savePosition({ xMeters: 0, yMeters: -9 });
    }).toThrow(/write failure/);
    next.close();
    expect(open(path).initialWorld.position).toEqual(position);
});

test('profile commits before confirmation, survives restart and repeated name is a no-op', () => {
    const path = createPath();
    const store = open(path);
    store.saveDisplayName('Иван Петров');
    expect(store.currentProfile()).toEqual({ displayName: 'Иван Петров', nameRevision: 1 });
    store.saveDisplayName('Иван Петров');
    expect(store.currentProfile().nameRevision).toBe(1);
    expect(() => {
        store.saveDisplayName('<script>');
    }).toThrow(/Invalid display name/);
    store.close();
    expect(open(path).currentProfile()).toEqual({ displayName: 'Иван Петров', nameRevision: 1 });
});

test('schema v1 migrates atomically and keeps character, world and position', () => {
    const path = createPath();
    const first = open(path);
    const initial = first.initialWorld;
    first.savePosition({ xMeters: 0, yMeters: -8 });
    first.close();
    const database = new DatabaseSync(path);
    database.exec(`ALTER TABLE solo_world DROP COLUMN combat_state;
        ALTER TABLE solo_world DROP COLUMN display_name;
        ALTER TABLE solo_world DROP COLUMN name_revision;
        ALTER TABLE solo_world DROP COLUMN item_location;
        PRAGMA user_version = 1`);
    database.close();
    const migrated = open(path);
    expect(migrated.initialWorld).toEqual({ ...initial, position: { xMeters: 0, yMeters: -8 } });
    expect(migrated.currentProfile()).toEqual({ displayName: 'Выживший', nameRevision: 0 });
    migrated.close();
    const restored = new DatabaseSync(path);
    expect(restored.prepare('PRAGMA user_version').get()?.['user_version']).toBe(7);
    restored.close();
});

test('failed name commit preserves both in-memory and durable profile', () => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database.exec(`CREATE TRIGGER reject_name BEFORE UPDATE OF display_name ON solo_world
        BEGIN SELECT RAISE(ABORT, 'profile disk failure'); END`);
    database.close();
    const store = open(path);
    const before = store.currentProfile();
    expect(() => {
        store.saveDisplayName('Новое имя');
    }).toThrow(/profile disk failure/);
    expect(store.currentProfile()).toEqual(before);
    store.close();
    expect(open(path).currentProfile()).toEqual(before);
});

test('a rejected old save rolls back the schema migration as well as its data', () => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database.exec(`ALTER TABLE solo_world DROP COLUMN combat_state;
        ALTER TABLE solo_world DROP COLUMN display_name;
        ALTER TABLE solo_world DROP COLUMN name_revision;
        ALTER TABLE solo_world DROP COLUMN item_location;
        UPDATE solo_world SET player_id = 'invalid';
        PRAGMA user_version = 1`);
    database.close();
    const bytes = readFileSync(path);
    expect(() => open(path)).toThrow(/invalid world data/);
    expect(readFileSync(path)).toEqual(bytes);
});

test('schema v2 migration retains profile and seeds the existing item only once', () => {
    const path = createPath();
    const original = open(path);
    original.saveDisplayName('Миграция');
    original.close();
    const database = new DatabaseSync(path);
    database.exec(
        'ALTER TABLE solo_world DROP COLUMN combat_state; ALTER TABLE solo_world DROP COLUMN item_location; PRAGMA user_version = 2',
    );
    database.close();
    const migrated = open(path);
    expect(migrated.currentProfile()).toEqual({ displayName: 'Миграция', nameRevision: 1 });
    expect(
        migrated.initialItemLocations.find(location => location.item.kind === 'bandage'),
    ).toEqual({ type: 'ground', item: initialGroundItem });
    const collected: ItemLocation = {
        type: 'container',
        playerId: migrated.initialWorld.playerId,
        item: { itemId: initialGroundItem.itemId, kind: 'bandage' },
        cell: { column: 2, row: 2 },
    };
    migrated.saveItemLocations([
        ...addStarterWeapons([collected], migrated.initialWorld.playerId),
        ...initialWorldWeaponLoot.map(item => ({ type: 'ground' as const, item })),
    ]);
    migrated.close();
    expect(
        open(path).initialItemLocations.find(location => location.item.kind === 'bandage'),
    ).toEqual(collected);
});

test('durable item transfer and cell are atomic, validated and retained after restart', () => {
    const path = createPath();
    const original = open(path);
    const playerId = original.initialWorld.playerId;
    const collected: ItemLocation = {
        type: 'container',
        playerId,
        item: { itemId: initialGroundItem.itemId, kind: 'bandage' },
        cell: { column: 0, row: 0 },
    };
    original.saveItemLocations([
        ...addStarterWeapons([collected], playerId),
        ...initialWorldWeaponLoot.map(item => ({ type: 'ground' as const, item })),
    ]);
    original.close();
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER fail_item BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'item disk failure'); END",
    );
    const before = database.prepare('SELECT item_location FROM solo_world').get();
    database.close();
    const restored = open(path);
    expect(
        restored.initialItemLocations.find(location => location.item.kind === 'bandage'),
    ).toEqual(collected);
    expect(() => {
        restored.saveItemLocations([
            ...addStarterWeapons([{ ...collected, cell: { column: 2, row: 2 } }], playerId),
            ...initialWorldWeaponLoot.map(item => ({ type: 'ground' as const, item })),
        ]);
    }).toThrow(/item disk failure/);
    expect(() => {
        restored.saveItemLocations(
            addStarterWeapons([{ ...collected, playerId: 'foreign' }], playerId),
        );
    }).toThrow(/invalid item/);
    expect(() => {
        restored.saveItemLocations([
            { ...collected, cell: { column: 3, row: 0 } },
            ...restored.initialItemLocations.filter(location => location.item.kind !== 'bandage'),
        ]);
    }).toThrow(/invalid item/);
    restored.close();
    const after = new DatabaseSync(path);
    expect(after.prepare('SELECT item_location FROM solo_world').get()).toEqual(before);
    after.close();
    expect(
        open(path).initialItemLocations.find(location => location.item.kind === 'bandage'),
    ).toEqual(collected);
});

test.each([
    'not json',
    '{}',
    '[]',
    JSON.stringify({ type: 'ground', item: { ...initialGroundItem, itemId: 'duplicate' } }),
    JSON.stringify({ type: 'ground', item: initialGroundItem, playerId: 'also-owned' }),
    JSON.stringify({
        type: 'ground',
        item: { ...initialGroundItem, position: { xMeters: 99, yMeters: 2 } },
    }),
    JSON.stringify({
        type: 'container',
        item: { itemId: initialGroundItem.itemId, kind: 'bandage' },
        playerId: 'foreign',
        cell: { column: 0, row: 0 },
    }),
])('invalid item save fails closed without resetting loot: %s', item => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET item_location = ?').run(item);
    database.close();
    const before = readFileSync(path);
    expect(() => open(path)).toThrow();
    expect(readFileSync(path)).toEqual(before);
});

test('v2 migration failure rolls back both schema and initialization', () => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database.exec(
        "ALTER TABLE solo_world DROP COLUMN combat_state; ALTER TABLE solo_world DROP COLUMN item_location; PRAGMA user_version = 2; CREATE TRIGGER reject_migration BEFORE UPDATE ON solo_world BEGIN SELECT RAISE(ABORT, 'migration failure'); END",
    );
    database.close();
    const bytes = readFileSync(path);
    expect(() => open(path)).toThrow(/migration failure/);
    expect(readFileSync(path)).toEqual(bytes);
});

test.each([
    { column: 0, row: 1 },
    { column: 2, row: 2 },
])('v3 migration keeps collected placement $column,$row and never grants another set', cell => {
    const path = createPath();
    const first = open(path);
    const playerId = first.initialWorld.playerId;
    first.close();
    const bandage = {
        type: 'container',
        playerId,
        item: { itemId: initialGroundItem.itemId, kind: 'bandage' },
        cell,
    };
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(bandage));
    database.exec('ALTER TABLE solo_world DROP COLUMN combat_state; PRAGMA user_version = 3');
    database.close();
    const migrated = open(path);
    expect(migrated.initialItemLocations).toHaveLength(9);
    expect(migrated.initialItemLocations[0]).toEqual(bandage);
    const equipped = migrated.initialItemLocations.map(location =>
        location.item.itemId === `${playerId}:axe`
            ? { type: 'hands' as const, playerId, item: location.item }
            : location,
    );
    migrated.saveItemLocations(equipped);
    migrated.close();
    const restored = open(path);
    expect(restored.initialItemLocations).toEqual(equipped);
    expect(new Set(restored.initialItemLocations.map(location => location.item.itemId)).size).toBe(
        9,
    );
});

test('failed v3 migration rolls back version and data, preserving the complete old save', () => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database
        .prepare('UPDATE solo_world SET item_location = ?')
        .run(JSON.stringify({ type: 'ground', item: initialGroundItem }));
    database.exec(
        "ALTER TABLE solo_world DROP COLUMN combat_state; PRAGMA user_version = 3; CREATE TRIGGER reject_weapons BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'weapon migration failure'); END",
    );
    database.close();
    const before = readFileSync(path);
    expect(() => open(path)).toThrow(/weapon migration failure/);
    expect(readFileSync(path)).toEqual(before);
});

test.each(['duplicate', 'missing', 'foreign', 'overlap', 'two-hands', 'wrong-kind'])(
    'v4 invalid %s locations fail closed without reissuing weapons',
    problem => {
        const path = createPath();
        const first = open(path);
        const locations = [...first.initialItemLocations];
        first.close();
        const firstWeapon = locations[1];
        const secondWeapon = locations[2];
        if (firstWeapon?.type !== 'container' || secondWeapon?.type !== 'container')
            throw new Error('Missing starter items.');
        if (problem === 'duplicate') locations[2] = firstWeapon;
        if (problem === 'missing') locations.pop();
        if (problem === 'foreign') locations[1] = { ...firstWeapon, playerId: 'foreign' };
        if (problem === 'overlap') locations[2] = { ...secondWeapon, cell: firstWeapon.cell };
        if (problem === 'two-hands') {
            locations[1] = {
                type: 'hands',
                playerId: first.initialWorld.playerId,
                item: firstWeapon.item,
            };
            locations[2] = {
                type: 'hands',
                playerId: first.initialWorld.playerId,
                item: secondWeapon.item,
            };
        }
        if (problem === 'wrong-kind')
            locations[1] = { ...firstWeapon, item: { ...firstWeapon.item, kind: 'axe' } };
        const database = new DatabaseSync(path);
        database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(locations));
        database.close();
        const before = readFileSync(path);
        expect(() => open(path)).toThrow(/invalid item/);
        expect(readFileSync(path)).toEqual(before);
    },
);

test('v4 migration adds the finite overlay once, preserving hands, profile, cells and world', () => {
    const path = createPath();
    const original = open(path);
    const playerId = original.initialWorld.playerId;
    const oldItems = original.initialItemLocations
        .filter(location => !location.item.itemId.startsWith('loot-v1:'))
        .map(location =>
            location.item.itemId === `${playerId}:axe`
                ? { type: 'hands' as const, playerId, item: location.item }
                : location,
        );
    original.saveDisplayName('Следопыт');
    original.close();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(oldItems));
    database.exec('ALTER TABLE solo_world DROP COLUMN combat_state; PRAGMA user_version = 4');
    const before = database
        .prepare(
            'SELECT world_id, player_id, seed, generator_version, x_meters, y_meters, display_name, name_revision FROM solo_world',
        )
        .get();
    database.close();
    const migrated = open(path);
    expect(migrated.initialItemLocations.slice(0, 5)).toEqual(oldItems);
    expect(migrated.initialItemLocations.slice(5)).toEqual(
        initialWorldWeaponLoot.map(item => ({ type: 'ground', item })),
    );
    const knife = initialWorldWeaponLoot.find(item => item.kind === 'knife');
    if (knife === undefined) throw new Error('Missing loot.');
    const collected = migrated.initialItemLocations.map(location =>
        location.item.itemId === knife.itemId
            ? {
                  type: 'container' as const,
                  playerId,
                  item: { itemId: knife.itemId, kind: knife.kind },
                  cell: { column: 0, row: 0 },
              }
            : location,
    );
    migrated.saveItemLocations(collected);
    migrated.close();
    const restored = open(path);
    expect(restored.initialItemLocations).toEqual(collected);
    restored.close();
    const saved = new DatabaseSync(path);
    expect(
        saved
            .prepare(
                'SELECT world_id, player_id, seed, generator_version, x_meters, y_meters, display_name, name_revision FROM solo_world',
            )
            .get(),
    ).toEqual(before);
    expect(saved.prepare('PRAGMA user_version').get()?.['user_version']).toBe(7);
    saved.close();
});

test.each(['missing', 'duplicate', 'foreign', 'kind', 'position', 'owner', 'starter-ground'])(
    'v5 rejects %s world loot without reset or regeneration',
    problem => {
        const path = createPath();
        const store = open(path);
        const locations = [...store.initialItemLocations];
        const loot = locations[5];
        if (loot?.type !== 'ground') throw new Error('Missing ground loot.');
        store.close();
        if (problem === 'missing') locations.pop();
        if (problem === 'duplicate') locations[6] = loot;
        if (problem === 'foreign')
            locations[5] = {
                type: 'container',
                playerId: 'foreign',
                item: { itemId: loot.item.itemId, kind: loot.item.kind },
                cell: { column: 0, row: 0 },
            };
        if (problem === 'kind') locations[5] = { ...loot, item: { ...loot.item, kind: 'axe' } };
        if (problem === 'position')
            locations[5] = {
                ...loot,
                item: { ...loot.item, position: { xMeters: 999, yMeters: 999 } },
            };
        if (problem === 'owner')
            Object.assign(locations[5] ?? {}, { playerId: store.initialWorld.playerId });
        if (problem === 'starter-ground')
            locations[5] = {
                type: 'ground',
                item: { ...loot.item, itemId: `${store.initialWorld.playerId}:knife` },
            };
        const database = new DatabaseSync(path);
        database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(locations));
        database.close();
        const before = readFileSync(path);
        expect(() => open(path)).toThrow(/invalid item/);
        expect(readFileSync(path)).toEqual(before);
    },
);

test('failed v4 overlay migration rolls back the old schema and all item locations', () => {
    const path = createPath();
    const first = open(path);
    const oldItems = first.initialItemLocations.slice(0, 5);
    first.close();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET item_location = ?').run(JSON.stringify(oldItems));
    database.exec(
        "ALTER TABLE solo_world DROP COLUMN combat_state; PRAGMA user_version = 4; CREATE TRIGGER reject_loot BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'loot migration failure'); END",
    );
    database.close();
    const before = readFileSync(path);
    expect(() => open(path)).toThrow(/loot migration failure/);
    expect(readFileSync(path)).toEqual(before);
});

test.each([100, 73, 0])(
    'combat round-trip keeps %s HP and remaining ticks with equipment',
    health => {
        const path = createPath();
        const first = open(path);
        const playerId = first.initialWorld.playerId;
        const equipped = first.initialItemLocations.map(location =>
            location.item.itemId === `${playerId}:axe`
                ? { type: 'hands' as const, playerId, item: location.item }
                : location,
        );
        first.saveCombat({ health, cooldownTicks: 17, bleedingTicks: 0 }, equipped);
        first.close();
        const restored = open(path);
        expect(restored.initialCombat).toEqual({ health, cooldownTicks: 17, bleedingTicks: 0 });
        expect(restored.initialItemLocations).toEqual(equipped);
    },
);

test.each([
    'not json',
    '{}',
    'null',
    '{"health":101,"cooldownTicks":0,"bleedingTicks":0}',
    '{"health":-1,"cooldownTicks":0,"bleedingTicks":0}',
    '{"health":1.5,"cooldownTicks":0,"bleedingTicks":0}',
    '{"health":"90","cooldownTicks":0,"bleedingTicks":0}',
    '{"health":90,"cooldownTicks":-1,"bleedingTicks":0}',
    '{"health":90,"cooldownTicks":25,"bleedingTicks":0}',
    '{"health":90,"cooldownTicks":0.5,"bleedingTicks":0}',
])('corrupt v7 combat state is rejected without resetting the save: %s', state => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE solo_world SET combat_state = ?').run(state);
    database.close();
    const before = readFileSync(path);
    expect(() => open(path)).toThrow();
    expect(readFileSync(path)).toEqual(before);
});

test('v5 migration seeds combat once while preserving the entire world and inventory', () => {
    const path = createPath();
    const first = open(path);
    const initial = first.initialWorld;
    const items = first.initialItemLocations;
    first.close();
    const database = new DatabaseSync(path);
    database.exec('ALTER TABLE solo_world DROP COLUMN combat_state; PRAGMA user_version = 5');
    database.close();
    const migrated = open(path);
    expect(migrated.initialWorld).toEqual(initial);
    expect(migrated.initialItemLocations).toEqual(items);
    expect(migrated.initialCombat).toEqual({ health: 100, cooldownTicks: 0, bleedingTicks: 0 });
    migrated.saveCombat({ health: 60, cooldownTicks: 9, bleedingTicks: 0 });
    migrated.close();
    expect(open(path).initialCombat).toEqual({ health: 60, cooldownTicks: 9, bleedingTicks: 0 });
});

test('invalid v5 item data aborts combat migration without changing the file', () => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database.exec('ALTER TABLE solo_world DROP COLUMN combat_state; PRAGMA user_version = 5');
    database.prepare('UPDATE solo_world SET item_location = ?').run('[]');
    database.close();
    const before = readFileSync(path);
    expect(() => open(path)).toThrow(/invalid item/);
    expect(readFileSync(path)).toEqual(before);
});

test('a failed combat/equipment commit keeps both previous values and rejects invalid state', () => {
    const path = createPath();
    const first = open(path);
    first.saveCombat({ health: 90, cooldownTicks: 4, bleedingTicks: 0 });
    first.close();
    const database = new DatabaseSync(path);
    database.exec(`CREATE TRIGGER reject_combat BEFORE UPDATE OF combat_state ON solo_world
        BEGIN SELECT RAISE(ABORT, 'combat disk failure'); END`);
    database.close();
    const store = open(path);
    const items = store.initialItemLocations;
    const playerId = store.initialWorld.playerId;
    const equipped = items.map(location =>
        location.item.itemId === `${playerId}:axe`
            ? { type: 'hands' as const, playerId, item: location.item }
            : location,
    );
    expect(() => {
        store.saveCombat({ health: 80, cooldownTicks: 24, bleedingTicks: 0 }, equipped);
    }).toThrow(/combat disk failure/);
    expect(() => {
        store.saveCombat({ health: -1, cooldownTicks: 0, bleedingTicks: 0 });
    }).toThrow(/combat state/);
    store.close();
    const restored = open(path);
    expect(restored.initialCombat).toEqual({ health: 90, cooldownTicks: 4, bleedingTicks: 0 });
    expect(restored.initialItemLocations).toEqual(items);
});

test('v6 migration preserves combat, world, profile and items and only adds an unwounded interval once', () => {
    const path = createPath();
    const first = open(path);
    first.saveDisplayName('Раненый');
    first.savePosition({ xMeters: 8, yMeters: 12 });
    const items = first.initialItemLocations;
    const ids = first.initialWorld;
    first.close();
    const database = new DatabaseSync(path);
    database.exec('PRAGMA user_version = 6');
    database
        .prepare('UPDATE solo_world SET combat_state = ?')
        .run(JSON.stringify({ health: 63, cooldownTicks: 7 }));
    database.close();
    const migrated = open(path);
    expect(migrated.initialWorld).toMatchObject({
        worldId: ids.worldId,
        playerId: ids.playerId,
        displayName: 'Раненый',
        position: { xMeters: 8, yMeters: 12 },
    });
    expect(migrated.initialItemLocations).toEqual(items);
    expect(migrated.initialCombat).toEqual({ health: 63, cooldownTicks: 7, bleedingTicks: 0 });
    migrated.saveCombat({ health: 62, cooldownTicks: 3, bleedingTicks: 17 });
    migrated.close();
    expect(open(path).initialCombat).toEqual({ health: 62, cooldownTicks: 3, bleedingTicks: 17 });
});

test.each([undefined, -1, 101, 1.5, '5', null])(
    'corrupt v7 bleeding interval %s is rejected without resetting the save',
    bleedingTicks => {
        const path = createPath();
        open(path).close();
        const database = new DatabaseSync(path);
        database
            .prepare('UPDATE solo_world SET combat_state = ?')
            .run(JSON.stringify({ health: 63, cooldownTicks: 7, bleedingTicks }));
        database.close();
        const before = readFileSync(path);
        expect(() => open(path)).toThrow(/combat state/);
        expect(readFileSync(path)).toEqual(before);
    },
);

test.each(['invalid combat', 'failed update'])('v6 wound migration rolls back on %s', failure => {
    const path = createPath();
    open(path).close();
    const database = new DatabaseSync(path);
    database.exec('PRAGMA user_version = 6');
    database
        .prepare('UPDATE solo_world SET combat_state = ?')
        .run(JSON.stringify({ health: failure === 'invalid combat' ? -1 : 60, cooldownTicks: 7 }));
    if (failure === 'failed update')
        database.exec(`CREATE TRIGGER reject_wound BEFORE UPDATE OF combat_state ON solo_world
        BEGIN SELECT RAISE(ABORT, 'wound migration failure'); END`);
    database.close();
    const before = readFileSync(path);
    expect(() => open(path)).toThrow();
    expect(readFileSync(path)).toEqual(before);
});
