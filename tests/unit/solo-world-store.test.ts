import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
    'PRAGMA user_version = 2',
    "UPDATE solo_world SET seed = 'another-world'",
    'UPDATE solo_world SET generator_version = 2',
    "UPDATE solo_world SET player_id = 'bad'",
    "UPDATE solo_world SET world_id = 'bad'",
    'UPDATE solo_world SET x_meters = 1e999',
    'UPDATE solo_world SET x_meters = 64000064',
    'UPDATE solo_world SET x_meters = 5.25, y_meters = 0',
    'DELETE FROM solo_world',
    'PRAGMA user_version = 0',
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
