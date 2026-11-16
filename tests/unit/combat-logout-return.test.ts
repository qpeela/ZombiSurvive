import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Client, Room } from '@colyseus/core';
import { combatSettings } from '@zombi-survive/content';
import { afterEach, expect, test, vi } from 'vitest';

import { LocalWorldRoom } from '../../apps/server/src/local-world-room.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

const directories: string[] = [];
const hosts: { room: LocalWorldRoom; store: SoloWorldStore }[] = [];

afterEach(() => {
    for (const host of hosts.splice(0)) {
        host.room.onDispose();
        host.store.close();
    }
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const seed = (health = 100, bleedingTicks = 0): string => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-logout-return-'));
    directories.push(directory);
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    store.savePosition({ xMeters: -7, yMeters: 0 });
    store.saveCombat({ health, cooldownTicks: 0, bleedingTicks });
    store.close();
    return path;
};

const start = (path: string) => {
    const store = new SoloWorldStore(path);
    const room = new LocalWorldRoom();
    let runStep = () => {};
    vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
        runStep = () => callback?.(50);
    });
    vi.spyOn(Room.prototype, 'onBeforeShutdown').mockImplementation(() => undefined);
    room.onCreate({
        access: new WorldAccess(false, 4000, 0, store.initialWorld.playerId),
        soloStore: store,
        onSaveError: error => {
            throw error;
        },
    });
    hosts.push({ room, store });
    return {
        room,
        store,
        tick: (count: number) => {
            for (let index = 0; index < count; index++) {
                runStep();
                vi.advanceTimersByTime(1);
            }
        },
    };
};

const joinPlayer = (host: ReturnType<typeof start>, sessionId: string) => {
    const send = vi.fn();
    const client = {
        sessionId,
        auth: host.store.initialWorld.playerId,
        send,
    } as unknown as Client;
    host.room.clients.push(client);
    host.room.onJoin(client);
    return { client, send };
};

const leavePlayer = (host: ReturnType<typeof start>, client: Client): void => {
    host.room.clients.splice(host.room.clients.indexOf(client), 1);
    host.room.onLeave(client);
};

const stop = (host: ReturnType<typeof start>): void => {
    host.room.onBeforeShutdown();
    host.room.onDispose();
    host.store.close();
};

test('returning before expiry controls the same wounded character', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const path = seed();
    const host = start(path);
    const first = joinPlayer(host, 'first');
    host.tick(combatSettings.attackIntervalTicks);
    leavePlayer(host, first.client);
    host.tick(combatSettings.attackIntervalTicks);

    const returned = joinPlayer(host, 'returned');
    host.tick(1);
    expect(returned.send).toHaveBeenCalledWith(
        'health-state',
        expect.objectContaining({ health: 80, lifeState: 'alive' }),
    );
    const movement: unknown = returned.send.mock.calls.find(
        ([type]) => type === 'movement-snapshot',
    )?.[1];
    expect(movement).toMatchObject({
        player: {
            playerId: host.store.initialWorld.playerId,
            position: { xMeters: -7, yMeters: 0 },
        },
    });
    stop(host);
    const restored = new SoloWorldStore(path);
    expect(restored.initialCombat).toEqual({ health: 80, cooldownTicks: 0, bleedingTicks: 0 });
    restored.close();
});

test('a fatal offline hit saves one corpse and returns to the death state after restart', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const path = seed(20);
    const host = start(path);
    const first = joinPlayer(host, 'first');
    host.tick(combatSettings.attackIntervalTicks);
    leavePlayer(host, first.client);
    host.tick(combatSettings.attackIntervalTicks + 40);
    stop(host);

    const saved = new SoloWorldStore(path);
    expect(saved.initialCombat.health).toBe(0);
    expect(saved.initialCombat.logoutVulnerabilityTicks).toBeUndefined();
    expect(saved.initialCorpses).toHaveLength(1);
    expect(saved.initialItemLocations.some(location => location.type === 'corpse')).toBe(true);
    saved.close();

    const restarted = start(path);
    const returned = joinPlayer(restarted, 'returned');
    restarted.tick(1);
    expect(returned.send).toHaveBeenCalledWith(
        'health-state',
        expect.objectContaining({ health: 0, lifeState: 'dead' }),
    );
    stop(restarted);
    const afterReturn = new SoloWorldStore(path);
    expect(afterReturn.initialCorpses).toHaveLength(1);
    afterReturn.close();
});

test('host restart resumes the saved vulnerability countdown', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const path = seed();
    const host = start(path);
    const first = joinPlayer(host, 'first');
    host.tick(combatSettings.attackIntervalTicks);
    leavePlayer(host, first.client);
    host.tick(37);
    stop(host);

    const saved = new SoloWorldStore(path);
    expect(saved.initialCombat.logoutVulnerabilityTicks).toBe(163);
    saved.close();
    const restarted = start(path);
    restarted.tick(13);
    stop(restarted);
    const afterRestart = new SoloWorldStore(path);
    expect(afterRestart.initialCombat.logoutVulnerabilityTicks).toBe(150);
    afterRestart.close();
});
