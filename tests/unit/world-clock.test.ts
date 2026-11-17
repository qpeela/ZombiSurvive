import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type Client, Room } from '@colyseus/core';
import { initialStateRequest, isMovementSnapshot } from '@zombi-survive/protocol';
import { movementStepSeconds, stepWorldClock } from '@zombi-survive/simulation';
import { afterEach, expect, test, vi } from 'vitest';

import { readMovementSnapshot } from '../../apps/client/src/movement-contract.ts';
import { formatWorldTime } from '../../apps/client/src/world-clock.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldRoom } from '../../apps/server/src/local-world-room.ts';
import { readSavedWorldTime } from '../../apps/server/src/saved-world-time.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test('twenty running steps advance one game minute independently of wall time', () => {
    let time = 0;
    for (let tick = 0; tick < 20; tick++) time = stepWorldClock(time, movementStepSeconds);
    expect(time).toBe(60_000);
    expect(() => stepWorldClock(time, 0.1)).toThrow(RangeError);
    expect(() => stepWorldClock(Number.MAX_SAFE_INTEGER, movementStepSeconds)).toThrow(RangeError);
});

test('the HUD formats initial time, midnight and a later day without a real calendar', () => {
    expect(formatWorldTime(0)).toBe('День 1 · 08:00');
    expect(formatWorldTime(60_000)).toBe('День 1 · 08:01');
    expect(formatWorldTime(16 * 60 * 60 * 1000)).toBe('День 2 · 00:00');
    expect(formatWorldTime(24 * 60 * 60 * 1000)).toBe('День 2 · 08:00');
});

test('an empty room checkpoints time and a restart excludes an entire stopped real day', () => {
    vi.useFakeTimers();
    vi.spyOn(Room.prototype, 'onBeforeShutdown').mockImplementation(() => undefined);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-empty-clock-'));
    const path = join(directory, 'world.sqlite');
    const start = (store: SoloWorldStore) => {
        const room = new LocalWorldRoom();
        let step = () => {};
        vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
            step = () => callback?.(50);
        });
        const handlers = new Map<string, (client: Client, value: unknown) => unknown>();
        vi.spyOn(room, 'onMessage').mockImplementation((type, handler: unknown) => {
            if (typeof type === 'string' && typeof handler === 'function')
                handlers.set(type, handler as (client: Client, value: unknown) => unknown);
            return () => {};
        });
        room.onCreate({
            access: new WorldAccess(false, 4000, 0, store.initialWorld.playerId),
            soloStore: store,
            onSaveError: error => {
                throw error;
            },
        });
        return { room, step, handlers };
    };
    let store = new SoloWorldStore(path);
    let active = start(store);
    try {
        for (let tick = 0; tick < 20; tick++) active.step();
        vi.advanceTimersByTime(1000);
        active.room.onBeforeShutdown();
        active.room.onDispose();
        store.close();
        vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
        store = new SoloWorldStore(path);
        expect(store.initialWorldTimeMs).toBe(60_000);
        active = start(store);
        const client = {
            sessionId: 'returned',
            auth: store.initialWorld.playerId,
        } as unknown as Client;
        active.room.onJoin(client);
        expect(active.handlers.get(initialStateRequest)?.(client, undefined)).toMatchObject({
            tick: 0,
            worldTimeMs: 60_000,
        });
        active.step();
        vi.advanceTimersByTime(1);
        active.room.onBeforeShutdown();
        active.room.onDispose();
        store.close();
        store = new SoloWorldStore(path);
        expect(store.initialWorldTimeMs).toBe(63_000);
    } finally {
        active.room.onDispose();
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('v15 migration initializes a clock without changing health, and corrupt time fails closed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-clock-migration-'));
    const path = join(directory, 'world.sqlite');
    try {
        const seed = new SoloWorldStore(path);
        seed.saveCombat({ health: 67, cooldownTicks: 0, bleedingTicks: 0 });
        seed.close();
        let database = new DatabaseSync(path);
        database.exec('ALTER TABLE solo_world DROP COLUMN world_time_ms; PRAGMA user_version = 15');
        database.close();
        const migrated = new SoloWorldStore(path);
        expect(migrated.initialWorldTimeMs).toBe(0);
        expect(migrated.initialCombat.health).toBe(67);
        migrated.close();
        database = new DatabaseSync(path);
        database.exec('UPDATE solo_world SET world_time_ms = -1');
        database.close();
        const bytes = readFileSync(path);
        expect(() => new SoloWorldStore(path)).toThrow('invalid world time');
        expect(readFileSync(path)).toEqual(bytes);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('combat, items and world time cannot partially commit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-clock-atomic-'));
    const path = join(directory, 'world.sqlite');
    try {
        const seed = new SoloWorldStore(path);
        seed.savePosition({ xMeters: 0, yMeters: 0 }, 9000);
        seed.close();
        const database = new DatabaseSync(path);
        database.exec(
            "CREATE TRIGGER reject_clock BEFORE UPDATE OF world_time_ms ON solo_world BEGIN SELECT RAISE(ABORT, 'clock failure'); END",
        );
        database.close();
        const store = new SoloWorldStore(path);
        const locations = store.initialItemLocations.map(location =>
            location.item.kind === 'bandage'
                ? {
                      type: 'container' as const,
                      playerId: store.initialWorld.playerId,
                      item: { itemId: 'starter-bandage', kind: 'bandage' as const },
                      cell: { column: 0, row: 0 },
                  }
                : location,
        );
        expect(() => {
            store.saveCombat(
                { health: 50, cooldownTicks: 0, bleedingTicks: 0 },
                locations,
                undefined,
                undefined,
                undefined,
                undefined,
                { worldTimeMs: 12_000 },
            );
        }).toThrow('clock failure');
        store.close();
        const restored = new SoloWorldStore(path);
        expect(restored.initialWorldTimeMs).toBe(9000);
        expect(restored.initialCombat.health).toBe(100);
        expect(
            restored.initialItemLocations.find(location => location.item.kind === 'bandage')?.type,
        ).toBe('ground');
        restored.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test.each([-1, 0.5, NaN, Infinity, '0', null])(
    'invalid world time is rejected at disk and transport boundaries: %s',
    value => {
        expect(() => readSavedWorldTime(value)).toThrow();
        const movement = new LocalWorldMovement('world', 'solo');
        movement.join('tab');
        expect(isMovementSnapshot({ ...movement.snapshot('tab'), worldTimeMs: value })).toBe(false);
        const snapshot = { ...movement.snapshot('tab'), worldTimeMs: 0 };
        expect(readMovementSnapshot(snapshot)?.worldTimeMs).toBe(0);
    },
);
