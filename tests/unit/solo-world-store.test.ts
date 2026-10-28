import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initialGroundItem } from '@zombi-survive/content';
import type { ItemLocation } from '@zombi-survive/domain';
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
    'PRAGMA user_version = 4',
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
    database.exec(`ALTER TABLE solo_world DROP COLUMN display_name;
        ALTER TABLE solo_world DROP COLUMN name_revision;
        ALTER TABLE solo_world DROP COLUMN item_location;
        PRAGMA user_version = 1`);
    database.close();
    const migrated = open(path);
    expect(migrated.initialWorld).toEqual({ ...initial, position: { xMeters: 0, yMeters: -8 } });
    expect(migrated.currentProfile()).toEqual({ displayName: 'Выживший', nameRevision: 0 });
    migrated.close();
    const restored = new DatabaseSync(path);
    expect(restored.prepare('PRAGMA user_version').get()?.['user_version']).toBe(3);
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
    database.exec(`ALTER TABLE solo_world DROP COLUMN display_name;
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
    database.exec('ALTER TABLE solo_world DROP COLUMN item_location; PRAGMA user_version = 2');
    database.close();
    const migrated = open(path);
    expect(migrated.currentProfile()).toEqual({ displayName: 'Миграция', nameRevision: 1 });
    expect(migrated.initialItemLocation).toEqual({ type: 'ground', item: initialGroundItem });
    const collected: ItemLocation = {
        type: 'container',
        playerId: migrated.initialWorld.playerId,
        item: { itemId: initialGroundItem.itemId, kind: 'bandage' },
        cell: { column: 2, row: 2 },
    };
    migrated.saveItemLocation(collected);
    migrated.close();
    expect(open(path).initialItemLocation).toEqual(collected);
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
    original.saveItemLocation(collected);
    original.close();
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER fail_item BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'item disk failure'); END",
    );
    const before = database.prepare('SELECT item_location FROM solo_world').get();
    database.close();
    const restored = open(path);
    expect(restored.initialItemLocation).toEqual(collected);
    expect(() => {
        restored.saveItemLocation({ ...collected, cell: { column: 2, row: 2 } });
    }).toThrow(/item disk failure/);
    expect(() => {
        restored.saveItemLocation({ ...collected, playerId: 'foreign' });
    }).toThrow(/invalid item/);
    expect(() => {
        restored.saveItemLocation({ ...collected, cell: { column: 3, row: 0 } });
    }).toThrow(/invalid item/);
    restored.close();
    const after = new DatabaseSync(path);
    expect(after.prepare('SELECT item_location FROM solo_world').get()).toEqual(before);
    after.close();
    expect(open(path).initialItemLocation).toEqual(collected);
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
        "ALTER TABLE solo_world DROP COLUMN item_location; PRAGMA user_version = 2; CREATE TRIGGER reject_migration BEFORE UPDATE ON solo_world BEGIN SELECT RAISE(ABORT, 'migration failure'); END",
    );
    database.close();
    const bytes = readFileSync(path);
    expect(() => open(path)).toThrow(/migration failure/);
    expect(readFileSync(path)).toEqual(bytes);
});
