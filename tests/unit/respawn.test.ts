import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type Client } from '@colyseus/core';
import type { Corpse } from '@zombi-survive/domain';
import {
    isCurrentLifeCommand,
    isHealthSnapshot,
    isMovementSnapshot,
    isRespawnCommand,
} from '@zombi-survive/protocol';
import { findRespawnPosition } from '@zombi-survive/simulation';
import { afterEach, expect, test, vi } from 'vitest';

import { LocalWorldRoom } from '../../apps/server/src/local-world-room.ts';
import { LocalWorldZombie } from '../../apps/server/src/local-world-zombie.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
const seed = () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-respawn-'));
    cleanups.push(() => {
        rmSync(directory, { recursive: true, force: true });
    });
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    const corpse: Corpse = {
        corpseId: 'old-life',
        playerId,
        diedAtMs: 1000,
        position: { xMeters: 0, yMeters: 0 },
    };
    const locations = store.initialItemLocations.map(location =>
        location.type === 'container' || location.type === 'hands'
            ? { type: 'corpse' as const, corpseId: corpse.corpseId, item: location.item }
            : location,
    );
    store.saveDisplayName('Вернувшийся');
    store.saveCombat(
        { health: 0, cooldownTicks: 0, bleedingTicks: 10 },
        locations,
        corpse.position,
        [corpse],
    );
    store.close();
    return { path, playerId, corpse, locations };
};
const setup = () => {
    vi.useFakeTimers();
    const saved = seed();
    const store = new SoloWorldStore(saved.path);
    const room = new LocalWorldRoom();
    let tick = () => {};
    vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
        tick = () => callback?.(50);
    });
    vi.spyOn(LocalWorldZombie.prototype, 'step').mockReturnValue({ zombies: [], obstacles: [] });
    const handlers = new Map<string, (client: Client, value: unknown) => void>();
    vi.spyOn(room, 'onMessage').mockImplementation((type, handler: unknown) => {
        if (typeof type === 'string' && typeof handler === 'function')
            handlers.set(type, handler as (client: Client, value: unknown) => void);
        return () => {};
    });
    const failure = vi.fn();
    room.onCreate({
        access: new WorldAccess(false, 4000, 0, saved.playerId),
        soloStore: store,
        onSaveError: failure,
    });
    const send = vi.fn<(type: string, value: unknown) => void>();
    const clients = ['first', 'tab'].map(
        sessionId => ({ sessionId, auth: saved.playerId, send }) as unknown as Client,
    );
    for (const client of clients) {
        room.clients.push(client);
        room.onJoin(client);
    }
    cleanups.unshift(() => {
        room.onDispose();
        store.close();
    });
    const dispatch = (type: string, fields: object = {}, tab = 0) => {
        const client = clients[tab];
        if (client === undefined) throw new Error('Missing client');
        handlers.get(type)?.(client, { type, protocolVersion: 5, ...fields });
    };
    const step = () => {
        tick();
        vi.advanceTimersByTime(1);
    };
    return { ...saved, store, room, send, dispatch, step, failure };
};

test('respawn intents require an explicit safe revision; gameplay from old lives is rejected', () => {
    expect(isRespawnCommand({ type: 'respawn-player', protocolVersion: 5, lifeRevision: 0 })).toBe(
        true,
    );
    for (const lifeRevision of [undefined, null, -1, 0.5, NaN, Infinity, '0'])
        expect(isRespawnCommand({ type: 'respawn-player', protocolVersion: 5, lifeRevision })).toBe(
            false,
        );
    expect(isCurrentLifeCommand({}, 0)).toBe(true);
    expect(isCurrentLifeCommand({}, 1)).toBe(false);
    expect(isCurrentLifeCommand({ lifeRevision: 0 }, 1)).toBe(false);
    expect(isCurrentLifeCommand({ lifeRevision: 1 }, 1)).toBe(true);
});

test('safe start skips walls, players and zombie attack range and fails when every position is blocked', () => {
    expect(findRespawnPosition({ obstacles: [], occupied: [], zombies: [] })).toEqual({
        xMeters: 0,
        yMeters: 0,
    });
    const obstacles = [
        { id: 'wall', minXMeters: -1, maxXMeters: 1, minYMeters: -1, maxYMeters: 1 },
    ];
    const position = findRespawnPosition({
        obstacles,
        occupied: [{ xMeters: -2, yMeters: -2 }],
        zombies: [{ xMeters: -2, yMeters: 0 }],
    });
    expect(position).not.toBeNull();
    if (position === null) throw new Error('Missing safe position');
    expect(Math.hypot(position.xMeters + 2, position.yMeters)).toBeGreaterThan(2.1);
    expect(position).not.toEqual({ xMeters: 0, yMeters: 0 });
    expect(
        findRespawnPosition({
            obstacles: [
                {
                    id: 'wall',
                    minXMeters: -100,
                    maxXMeters: 100,
                    minYMeters: -100,
                    maxYMeters: 100,
                },
            ],
            occupied: [],
            zombies: [],
        }),
    ).toBeNull();
});

test('two tabs and repeated requests create exactly one durable life, empty hands and unchanged name/body', () => {
    const { store, path, corpse, locations, dispatch, step, send } = setup();
    const save = vi.spyOn(store, 'saveRespawn');
    dispatch('respawn-player', { lifeRevision: 0 });
    dispatch('respawn-player', { lifeRevision: 0 }, 1);
    dispatch('movement-input', {
        lifeRevision: 0,
        sequence: 1,
        direction: { x: 1, y: 0 },
        isSprinting: false,
        isSneaking: false,
    });
    step();
    expect(save).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    dispatch('respawn-player', { lifeRevision: 0 });
    step();
    expect(save).toHaveBeenCalledOnce();
    const health = send.mock.calls.filter(([type]) => type === 'health-state');
    expect(health).toHaveLength(2);
    for (const [, value] of health) {
        expect(isHealthSnapshot(value)).toBe(true);
        expect(value).toMatchObject({
            health: 100,
            bleedingTicks: 0,
            lifeState: 'alive',
            lifeRevision: 1,
        });
    }
    store.close();
    const restored = new SoloWorldStore(path);
    expect(restored.initialCombat).toEqual({
        health: 100,
        cooldownTicks: 0,
        bleedingTicks: 0,
        lifeRevision: 1,
    });
    expect(restored.initialItemLocations).toEqual(locations);
    expect(restored.initialCorpses).toEqual([corpse]);
    expect(restored.initialWorld.displayName).toBe('Вернувшийся');
    expect(restored.initialWorld.position).toEqual({ xMeters: 0, yMeters: 0 });
    restored.close();
});

test('old movement, loot, equip, melee and bandage commands cannot affect the new life; fresh commands work', () => {
    const { dispatch, step, send, playerId } = setup();
    dispatch('respawn-player', { lifeRevision: 0 });
    step();
    const itemId = `${playerId}:knife`;
    const fields = {
        lifeRevision: 0,
        itemId,
        inventoryVersion: 2,
        meleeVersion: 3,
        sequence: 10,
        direction: { x: 1, y: 0 },
        isSprinting: true,
        isSneaking: false,
        target: { xMeters: 10, yMeters: 0 },
        cell: { column: 0, row: 0 },
    };
    for (const type of [
        'movement-input',
        'movement-target',
        'pickup-item',
        'equip-weapon',
        'inventory-move',
        'melee-attack',
        'use-bandage',
    ]) {
        dispatch(type, fields);
        step();
    }
    expect(send.mock.calls.some(([type]) => type === 'melee-action')).toBe(false);
    expect(
        send.mock.calls.filter(([type]) => type === 'movement-snapshot').at(-1)?.[1],
    ).toMatchObject({ player: { position: { xMeters: 0, yMeters: 0 } } });
    expect(send.mock.calls.filter(([type]) => type === 'pickup-state').at(-1)?.[1]).toMatchObject({
        items: [],
        hands: null,
    });
    dispatch('pickup-item', { lifeRevision: 1, itemId });
    step();
    expect(send.mock.calls.filter(([type]) => type === 'pickup-state').at(-1)?.[1]).toMatchObject({
        items: [{ itemId, kind: 'knife' }],
    });
    dispatch('movement-input', { ...fields, lifeRevision: 1 });
    step();
    const movement = send.mock.calls.filter(([type]) => type === 'movement-snapshot').at(-1)?.[1];
    if (!isMovementSnapshot(movement)) throw new Error('Missing movement');
    expect(movement.player.position.xMeters).toBeCloseTo(0.35, 10);
});

test('failed respawn commit publishes nothing and preserves death and body for retry after restart', () => {
    const { store, path, corpse, dispatch, step, send, failure } = setup();
    vi.spyOn(store, 'saveRespawn').mockImplementation(() => {
        throw new Error('respawn disk failure');
    });
    dispatch('respawn-player', { lifeRevision: 0 });
    step();
    step();
    expect(failure).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    store.close();
    const restored = new SoloWorldStore(path);
    expect(restored.initialCombat.health).toBe(0);
    expect(restored.initialCorpses).toEqual([corpse]);
    restored.close();
});

test('SQLite rejects a repeated or failed respawn transaction without changing the saved life', () => {
    const { path } = seed();
    let store = new SoloWorldStore(path);
    const state = store.saveRespawn(0, { xMeters: 0, yMeters: 0 });
    expect(() => store.saveRespawn(0, { xMeters: 0, yMeters: -2 })).toThrow(/obsolete/);
    store.close();
    const database = new DatabaseSync(path);
    database.exec(
        'UPDATE solo_world SET combat_state = \'{"health":0,"cooldownTicks":0,"bleedingTicks":0,"lifeRevision":1}\'; CREATE TRIGGER reject_respawn BEFORE UPDATE OF combat_state ON solo_world BEGIN SELECT RAISE(ABORT, \'disk failure\'); END',
    );
    database.close();
    store = new SoloWorldStore(path);
    expect(() => store.saveRespawn(1, { xMeters: 0, yMeters: -2 })).toThrow(/disk failure/);
    store.close();
    store = new SoloWorldStore(path);
    expect(store.initialCombat).toEqual({ ...state, health: 0 });
    expect(store.initialWorld.position).toEqual({ xMeters: 0, yMeters: 0 });
    store.close();
});

test.each([-1, 0.5, null, '1', Infinity])(
    'health and saved combat reject invalid life revision %j',
    lifeRevision => {
        const { path } = seed();
        const database = new DatabaseSync(path);
        database
            .prepare('UPDATE solo_world SET combat_state = ?')
            .run(JSON.stringify({ health: 0, cooldownTicks: 0, bleedingTicks: 0, lifeRevision }));
        database.close();
        expect(() => new SoloWorldStore(path)).toThrow(/life revision/);
        expect(
            isHealthSnapshot({
                type: 'health-state',
                protocolVersion: 5,
                healthVersion: 3,
                worldId: 'world',
                playerId: 'player',
                tick: 1,
                health: 0,
                maxHealth: 100,
                bleedingTicks: 0,
                lifeState: 'dead',
                lifeRevision,
            }),
        ).toBe(false);
    },
);
