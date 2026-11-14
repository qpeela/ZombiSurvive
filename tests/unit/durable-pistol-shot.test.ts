import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Client, Room } from '@colyseus/core';
import { firearmVersion, protocolVersion } from '@zombi-survive/protocol';
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
const setup = ({ health = 100, bleedingTicks = 0, lifeRevision = 0 } = {}) => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'zombi-shot-commit-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    const playerId = seed.initialWorld.playerId;
    const gun = seed.initialItemLocations.find(location => location.item.kind === 'pistol')?.item;
    if (gun?.kind !== 'pistol') throw new Error('Missing gun');
    seed.saveItemLocations(
        seed.initialItemLocations.map(location =>
            location.item.itemId === gun.itemId
                ? {
                      type: 'hands',
                      playerId,
                      item: { itemId: gun.itemId, kind: 'pistol', rounds: 8, magazineCapacity: 8 },
                  }
                : location,
        ),
    );
    seed.saveCombat({
        health,
        cooldownTicks: 0,
        bleedingTicks,
        ...(lifeRevision === 0 ? {} : { lifeRevision }),
    });
    seed.close();
    const store = new SoloWorldStore(path);
    const room = new LocalWorldRoom();
    let tick = () => {};
    vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
        tick = () => callback?.(50);
    });
    vi.spyOn(Room.prototype, 'onBeforeShutdown').mockImplementation(() => undefined);
    vi.spyOn(LocalWorldZombie.prototype, 'step').mockReturnValue({ zombies: [], obstacles: [] });
    vi.spyOn(LocalWorldZombie.prototype, 'shotTargets').mockReturnValue([
        { zombieId: 'z', targetPlayerId: null, position: { xMeters: 8, yMeters: 0 } },
    ]);
    const damage = vi
        .spyOn(LocalWorldZombie.prototype, 'damage')
        .mockReturnValue({ damage: 30, isKilled: false });
    const handlers = new Map<string, (client: Client, value: unknown) => void>();
    vi.spyOn(room, 'onMessage').mockImplementation((type, handler: unknown) => {
        if (typeof type === 'string' && typeof handler === 'function')
            handlers.set(type, handler as (client: Client, value: unknown) => void);
        return () => {};
    });
    const failure = vi.fn();
    room.onCreate({
        access: new WorldAccess(false, 4000, 0, playerId),
        soloStore: store,
        onSaveError: failure,
    });
    const send = vi.fn<(type: string, value: unknown) => void>();
    const clients = ['first', 'tab'].map(
        sessionId => ({ sessionId, auth: playerId, send }) as unknown as Client,
    );
    for (const client of clients) {
        room.clients.push(client);
        room.onJoin(client);
    }
    cleanups.push(() => {
        room.onDispose();
        store.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const shoot = (revision = 0, token = lifeRevision) => {
        for (const client of clients)
            handlers.get('shoot-pistol')?.(client, {
                type: 'shoot-pistol',
                protocolVersion,
                firearmVersion,
                itemId: gun.itemId,
                weaponRevision: revision,
                aim: { x: 1, y: 0 },
                lifeRevision: token,
            });
    };
    const read = () => {
        store.close();
        const loaded = new SoloWorldStore(path);
        try {
            return {
                combat: loaded.initialCombat,
                items: loaded.initialItemLocations,
                corpses: loaded.initialCorpses,
            };
        } finally {
            loaded.close();
        }
    };
    return {
        room,
        store,
        send,
        failure,
        shoot,
        tick: () => {
            tick();
        },
        flush: () => vi.advanceTimersByTime(1),
        read,
        damage,
    };
};
test('ammo/revision and cooldown commit together outside the step before any shot publication', () => {
    const state = setup();
    const save = vi.spyOn(state.store, 'saveCombat');
    state.shoot();
    state.tick();
    state.tick();
    expect(save).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
    state.flush();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toMatchObject({ cooldownTicks: 10 });
    expect(
        save.mock.calls[0]?.[1]?.find(location => location.item.kind === 'pistol'),
    ).toMatchObject({ type: 'hands', item: { rounds: 7, revision: 1 } });
    const action = state.send.mock.calls.find(([type]) => type === 'shot-action')?.[1];
    expect(action).toMatchObject({ weaponRevision: 1, impact: { damage: 30 } });
    expect(state.damage).toHaveBeenCalledOnce();
    state.shoot();
    for (let count = 0; count < 12; count++) {
        state.tick();
        state.flush();
    }
    state.shoot();
    state.tick();
    state.flush();
    expect(state.damage).toHaveBeenCalledOnce();
    expect(state.read().items.find(location => location.item.kind === 'pistol')).toMatchObject({
        item: { rounds: 7, revision: 1 },
    });
});
test('failed shot commit publishes nothing, stops the host and retains the previous magazine', () => {
    const state = setup();
    vi.spyOn(state.store, 'saveCombat').mockImplementation(() => {
        throw new Error('disk full');
    });
    state.shoot();
    state.tick();
    state.flush();
    expect(state.failure).toHaveBeenCalledExactlyOnceWith(new Error('disk full'));
    expect(state.send).not.toHaveBeenCalled();
    state.tick();
    state.flush();
    expect(state.failure).toHaveBeenCalledOnce();
    expect(state.read().items.find(location => location.item.kind === 'pistol')).toMatchObject({
        item: { rounds: 8 },
    });
});
test('a simultaneous bleeding death stores the spent magazine in its new body in one commit', () => {
    const state = setup({ health: 1, bleedingTicks: 1 });
    const save = vi.spyOn(state.store, 'saveCombat');
    state.shoot();
    state.tick();
    state.flush();
    expect(save).toHaveBeenCalledOnce();
    const saved = state.read();
    expect(saved.combat).toMatchObject({ health: 0, cooldownTicks: 10 });
    expect(saved.items.find(location => location.item.kind === 'pistol')).toMatchObject({
        type: 'corpse',
        item: { rounds: 7, revision: 1 },
    });
    expect(saved.corpses).toMatchObject([{ playerId: state.store.initialWorld.playerId }]);
});
test('graceful shutdown flushes a prepared shot once, and stale life commands cannot shoot', () => {
    const state = setup({ lifeRevision: 2 });
    state.shoot(0, 1);
    state.tick();
    state.flush();
    expect(state.damage).not.toHaveBeenCalled();
    state.send.mockClear();
    state.shoot();
    state.tick();
    state.room.onBeforeShutdown();
    state.flush();
    expect(state.read().combat).toMatchObject({ cooldownTicks: 10, lifeRevision: 2 });
    expect(state.damage).toHaveBeenCalledOnce();
});
