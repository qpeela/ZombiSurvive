import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Client, Room } from '@colyseus/core';
import { combatSettings } from '@zombi-survive/content';
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

const setup = ({ health = 100, cooldownTicks = 0 } = {}) => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'zombi-combat-step-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    seed.saveCombat({ health, cooldownTicks });
    seed.close();
    const store = new SoloWorldStore(path);
    const room = new LocalWorldRoom();
    let step = () => {};
    vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
        step = () => callback?.(50);
    });
    vi.spyOn(Room.prototype, 'onBeforeShutdown').mockImplementation(() => undefined);
    const onSaveError = vi.fn();
    room.onCreate({
        access: new WorldAccess(false, 4000, 0, store.initialWorld.playerId),
        soloStore: store,
        onSaveError,
    });
    const send = vi.fn();
    const client = {
        sessionId: 'tab',
        auth: store.initialWorld.playerId,
        send,
    } as unknown as Client;
    room.clients.push(client);
    room.onJoin(client);
    cleanups.push(() => {
        room.onDispose();
        store.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const restored = () => {
        store.close();
        const loaded = new SoloWorldStore(path);
        const state = loaded.initialCombat;
        loaded.close();
        return state;
    };

    return {
        room,
        store,
        step: () => {
            step();
        },
        send,
        onSaveError,
        restored,
    };
};

test('cooldown commits outside timestep before publication and freezes overlapping steps', () => {
    const { store, step, send, restored } = setup({ health: 70, cooldownTicks: 9 });
    const save = vi.spyOn(store, 'saveCombat');
    step();
    step();
    expect(save).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith({ health: 70, cooldownTicks: 8 }, undefined);
    expect(send).toHaveBeenCalledWith(
        'health-state',
        expect.objectContaining({ health: 70, tick: 1 }),
    );
    step();
    vi.advanceTimersByTime(1);
    expect(restored()).toEqual({ health: 70, cooldownTicks: 7 });
});

test('actual zombie damage is committed before any snapshot from its step', () => {
    const { store, step, send, restored } = setup();
    vi.spyOn(LocalWorldZombie.prototype, 'step').mockReturnValue({
        zombies: [
            {
                zombieId: 'z',
                targetPlayerId: store.initialWorld.playerId,
                position: { xMeters: -0.9, yMeters: 0 },
            },
        ],
        obstacles: [],
    });
    vi.spyOn(LocalWorldZombie.prototype, 'isAlive').mockReturnValue(true);
    for (let tick = 0; tick < combatSettings.attackIntervalTicks - 1; tick++) step();
    send.mockClear();
    step();
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith('health-state', expect.objectContaining({ health: 90 }));
    expect(restored()).toEqual({ health: 90, cooldownTicks: 0 });
});

test('failed combat commit emits no snapshots, stops steps and preserves durable health', () => {
    const { store, room, step, send, onSaveError, restored } = setup({
        health: 0,
        cooldownTicks: 3,
    });
    const save = vi.spyOn(store, 'saveCombat').mockImplementation(() => {
        throw new Error('disk full');
    });
    step();
    vi.advanceTimersByTime(1);
    expect(onSaveError).toHaveBeenCalledExactlyOnceWith(new Error('disk full'));
    expect(send).not.toHaveBeenCalled();
    step();
    room.onBeforeShutdown();
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledOnce();
    expect(restored()).toEqual({ health: 0, cooldownTicks: 3 });
});

test('graceful shutdown flushes a prepared combat step exactly once', () => {
    const { store, room, step, restored } = setup({ health: 0, cooldownTicks: 3 });
    const save = vi.spyOn(store, 'saveCombat');
    step();
    room.onBeforeShutdown();
    vi.advanceTimersByTime(2);
    expect(save).toHaveBeenCalledExactlyOnceWith({ health: 0, cooldownTicks: 2 }, undefined);
    expect(restored()).toEqual({ health: 0, cooldownTicks: 2 });
});
