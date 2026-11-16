import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type Client, Room } from '@colyseus/core';
import { initialZombie } from '@zombi-survive/content';
import { meleeVersion, protocolVersion } from '@zombi-survive/protocol';
import { afterEach, expect, test, vi } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldRoom } from '../../apps/server/src/local-world-room.ts';
import { LocalWorldZombie } from '../../apps/server/src/local-world-zombie.ts';
import { readSavedZombies } from '../../apps/server/src/saved-zombie.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test('a melee hit commits zombie HP before publishing the attack', () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'zombi-zombie-melee-'));
    const path = join(directory, 'world.sqlite');
    let store = new SoloWorldStore(path);
    store.savePosition({ xMeters: -9, yMeters: 0 });
    store.close();
    store = new SoloWorldStore(path);
    const room = new LocalWorldRoom();
    let tick = () => {};
    vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
        tick = () => callback?.(50);
    });
    vi.spyOn(Room.prototype, 'onBeforeShutdown').mockImplementation(() => undefined);
    const handlers = new Map<string, (client: Client, value: unknown) => void>();
    vi.spyOn(room, 'onMessage').mockImplementation((type, handler: unknown) => {
        if (typeof type === 'string' && typeof handler === 'function')
            handlers.set(type, handler as (client: Client, value: unknown) => void);
        return () => {};
    });
    const failure = vi.fn();
    try {
        room.onCreate({
            access: new WorldAccess(false, 4000, 0, store.initialWorld.playerId),
            soloStore: store,
            onSaveError: failure,
        });
        const send = vi.fn<(type: string, value: unknown) => void>();
        const client = {
            sessionId: 'first',
            auth: store.initialWorld.playerId,
            send,
        } as unknown as Client;
        room.clients.push(client);
        room.onJoin(client);
        handlers.get('equip-weapon')?.(client, {
            type: 'equip-weapon',
            itemId: `${store.initialWorld.playerId}:club`,
            protocolVersion,
            meleeVersion,
        });
        tick();
        vi.advanceTimersByTime(1);
        handlers.get('melee-attack')?.(client, {
            type: 'melee-attack',
            protocolVersion,
            meleeVersion,
        });
        const save = vi.spyOn(store, 'saveCombat');
        send.mockClear();
        tick();
        expect(send).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(failure).not.toHaveBeenCalled();
        expect(save).toHaveBeenCalledOnce();
        const action: unknown = send.mock.calls.find(([type]) => type === 'melee-action')?.[1];
        expect(action).toMatchObject({ impact: { damage: 34 } });
        expect(save.mock.calls[0]?.[4]?.get(initialZombie.zombieId)).toBe(66);
    } finally {
        room.onDispose();
        store.close();
    }
    try {
        const restored = new SoloWorldStore(path);
        expect(restored.initialZombieHealth.get(initialZombie.zombieId)).toBe(66);
        restored.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('wounded and dead zombies retain their HP across a restart and a chunk revisit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-zombie-save-'));
    const path = join(directory, 'world.sqlite');
    try {
        const store = new SoloWorldStore(path);
        const movement = new LocalWorldMovement(
            store.initialWorld.worldId,
            store.initialWorld.playerId,
        );
        movement.join('first');
        const snapshots = new Map([['first', movement.snapshot('first')]]);
        const zombies = new LocalWorldZombie(store.initialZombieHealth);
        zombies.step(snapshots);
        const woundedId = 'slow:0,0:24,0';
        const deadId = 'slow:0,0:-24,0';
        expect(zombies.isAlive(woundedId)).toBe(true);
        expect(zombies.isAlive(deadId)).toBe(true);
        expect(zombies.damage(woundedId, 34)).toEqual({ damage: 34, isKilled: false });
        expect(zombies.damage(deadId, 100)).toEqual({ damage: 100, isKilled: true });
        expect(zombies.pendingHealthSave()).toEqual(
            new Map([
                [woundedId, 66],
                [deadId, 0],
            ]),
        );
        store.saveCombat(
            store.initialCombat,
            undefined,
            undefined,
            undefined,
            zombies.pendingHealthSave() ?? undefined,
        );
        zombies.confirmHealthSave();
        expect(zombies.pendingHealthSave()).toBeNull();
        store.close();

        const restored = new SoloWorldStore(path);
        expect(restored.initialZombieHealth).toEqual(
            new Map([
                [deadId, 0],
                [woundedId, 66],
            ]),
        );
        const resumed = new LocalWorldZombie(restored.initialZombieHealth);
        resumed.step(snapshots);
        resumed.step(new Map());
        resumed.step(snapshots);
        expect(resumed.isAlive(deadId)).toBe(false);
        expect(resumed.damage(deadId, 1)).toBeNull();
        expect(resumed.damage(woundedId, 66)).toEqual({ damage: 66, isKilled: true });
        restored.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a killed starting zombie does not respawn after host restart', () => {
    const zombie = new LocalWorldZombie(new Map([[initialZombie.zombieId, 0]]));
    expect(zombie.isAlive(initialZombie.zombieId)).toBe(false);
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    zombie.step(new Map([['first', movement.snapshot('first')]]));
    expect(zombie.isAlive(initialZombie.zombieId)).toBe(false);
});

test('corrupt saved zombie health rejects the world without replacing its file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-zombie-invalid-'));
    const path = join(directory, 'world.sqlite');
    try {
        new SoloWorldStore(path).close();
        const database = new DatabaseSync(path);
        database
            .prepare('UPDATE solo_world SET zombie_health = ? WHERE id = 1')
            .run(JSON.stringify([[initialZombie.zombieId, 101]]));
        database.close();
        const bytes = readFileSync(path);
        expect(() => new SoloWorldStore(path)).toThrow('invalid zombie health');
        expect(readFileSync(path)).toEqual(bytes);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('v13 world adds empty zombie health without changing prior combat', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-zombie-migration-'));
    const path = join(directory, 'world.sqlite');
    try {
        const seed = new SoloWorldStore(path);
        seed.saveCombat({ health: 67, cooldownTicks: 3, bleedingTicks: 0 });
        seed.close();
        const database = new DatabaseSync(path);
        database.exec('ALTER TABLE solo_world DROP COLUMN zombie_health; PRAGMA user_version = 13');
        database.close();
        const restored = new SoloWorldStore(path);
        expect(restored.initialCombat.health).toBe(67);
        expect(restored.initialZombieHealth.size).toBe(0);
        restored.close();
        const migrated = new DatabaseSync(path);
        expect(migrated.prepare('PRAGMA user_version').get()?.['user_version']).toBe(14);
        migrated.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test.each([
    [['unknown', 0]],
    [['slow:0,0:24,0', 100]],
    [['slow:0,0:24,0', -1]],
    [['slow:0,0:24,0', 50.5]],
    [
        ['slow:0,0:24,0', 0],
        ['slow:0,0:24,0', 0],
    ],
])('invalid zombie health records are rejected: %j', (...records) => {
    expect(() => readSavedZombies(JSON.stringify(records))).toThrow('invalid zombie health');
});
