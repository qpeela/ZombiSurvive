import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Client, Room } from '@colyseus/core';
import { isMovementSnapshot } from '@zombi-survive/protocol';
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

const setup = ({ health = 1, bleedingTicks = 1, hasBandage = true } = {}) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-death-step-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    const playerId = seed.initialWorld.playerId;
    const locations = seed.initialItemLocations
        .map(location =>
            location.item.kind === 'bandage'
                ? {
                      type: 'container' as const,
                      playerId,
                      item: { itemId: 'starter-bandage', kind: 'bandage' as const },
                      cell: { column: 0, row: 0 },
                  }
                : location,
        )
        .filter(location => hasBandage || location.item.kind !== 'bandage');
    seed.saveCombat({ health, cooldownTicks: 0, bleedingTicks }, locations);
    seed.close();
    const store = new SoloWorldStore(path);
    const room = new LocalWorldRoom();
    let timestep = () => {};
    vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
        timestep = () => callback?.(50);
    });
    vi.spyOn(Room.prototype, 'onBeforeShutdown').mockImplementation(() => undefined);
    vi.spyOn(LocalWorldZombie.prototype, 'step').mockReturnValue({ zombies: [], obstacles: [] });
    const handlers = new Map<string, (client: Client, command: unknown) => void>();
    vi.spyOn(room, 'onMessage').mockImplementation((type, handler: unknown) => {
        if (typeof type === 'string' && typeof handler === 'function') {
            // The SDK overload inferred by spyOn is the schema overload; Room registers a callback here.
            handlers.set(type, handler as (client: Client, command: unknown) => void);
        }
        return () => {};
    });
    const onSaveError = vi.fn();
    room.onCreate({
        access: new WorldAccess(false, 4000, 0, playerId),
        soloStore: store,
        onSaveError,
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
    const restored = () => {
        store.close();
        const loaded = new SoloWorldStore(path);
        const saved = {
            combat: loaded.initialCombat,
            locations: loaded.initialItemLocations,
            position: loaded.initialWorld.position,
        };
        loaded.close();
        return saved;
    };
    const use = (itemId = 'starter-bandage') => {
        for (const client of clients)
            handlers.get('use-bandage')?.(client, {
                type: 'use-bandage',
                protocolVersion: 5,
                inventoryVersion: 2,
                itemId,
            });
    };
    const dispatch = (type: string, value: unknown, clientIndex = 0) => {
        const client = clients[clientIndex];
        if (client === undefined) throw new Error('Missing test client.');

        handlers.get(type)?.(client, value);
    };

    return {
        room,
        store,
        step: () => {
            timestep();
        },
        send,
        use,
        dispatch,
        onSaveError,
        restored,
        playerId,
    };
};

test.each(['bleeding', 'zombie', 'both'] as const)(
    '%s commits one death and final moving position before either tab sees it',
    source => {
        const { step, dispatch, send, store, restored, playerId } = setup({
            health: 1,
            bleedingTicks: source === 'zombie' ? 0 : 20,
        });
        const save = vi.spyOn(store, 'saveCombat');
        if (source !== 'bleeding') {
            vi.spyOn(LocalWorldZombie.prototype, 'step').mockReturnValue({
                zombies: [
                    {
                        zombieId: 'z',
                        targetPlayerId: playerId,
                        position: { xMeters: -0.9, yMeters: 0 },
                    },
                ],
                obstacles: [],
            });
            vi.spyOn(LocalWorldZombie.prototype, 'isAlive').mockReturnValue(true);
        }
        for (let tick = 0; tick < 19; tick++) {
            step();
            vi.advanceTimersByTime(1);
        }
        send.mockClear();
        dispatch('movement-input', {
            type: 'movement-input',
            protocolVersion: 5,
            sequence: 1,
            direction: { x: 0, y: -1 },
            isSprinting: true,
            isSneaking: true,
        });
        step();
        step();
        expect(send).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        const deaths = send.mock.calls.filter(([type]) => type === 'health-state');
        expect(deaths).toHaveLength(2);
        for (const [, state] of deaths)
            expect(state).toMatchObject({ health: 0, lifeState: 'dead', tick: 20 });
        const movement = send.mock.calls.find(([type]) => type === 'movement-snapshot')?.[1];
        if (!isMovementSnapshot(movement)) throw new Error('Missing movement snapshot.');
        expect(movement.player).toMatchObject({
            position: { xMeters: 0, yMeters: -0.1 },
            isSneaking: false,
            noiseRadiusMeters: 0,
        });
        for (let tick = 0; tick < 40; tick++) {
            step();
            vi.advanceTimersByTime(1);
        }
        expect(save.mock.calls.filter(([state]) => state.health === 0)).toHaveLength(1);
        expect(restored()).toMatchObject({
            combat: { health: 0 },
            position: { xMeters: 0, yMeters: -0.1 },
        });
    },
);

test('dead tabs cannot move, loot, rearrange, equip, attack or use their retained items', () => {
    const { dispatch, use, step, send, store, restored, playerId } = setup({ health: 0 });
    const before = store.initialItemLocations;
    const save = vi.spyOn(store, 'saveCombat');
    for (let tab = 0; tab < 2; tab++) {
        const command = (type: string, fields: object) => {
            dispatch(
                type,
                { type, protocolVersion: 5, inventoryVersion: 2, meleeVersion: 3, ...fields },
                tab,
            );
            step();
            vi.advanceTimersByTime(1);
        };
        command('movement-input', {
            sequence: 1,
            direction: { x: 0, y: -1 },
            isSprinting: true,
            isSneaking: true,
        });
        command('movement-target', {
            sequence: 2,
            target: { xMeters: 0, yMeters: -10 },
            isSprinting: true,
            isSneaking: false,
        });
        command('pickup-item', {
            itemId: before.find(location => location.type === 'ground')?.item.itemId,
        });
        command('inventory-move', { itemId: 'starter-bandage', cell: { column: 2, row: 2 } });
        command('equip-weapon', { itemId: playerId + ':knife' });
        command('unequip-weapon', { itemId: playerId + ':knife' });
        command('melee-attack', {});
    }
    use();
    step();
    vi.advanceTimersByTime(1);
    expect(save).not.toHaveBeenCalled();
    expect(send.mock.calls.some(([type]) => type === 'melee-action')).toBe(false);
    const movements = send.mock.calls.filter(([type]) => type === 'movement-snapshot');
    for (const [, state] of movements)
        expect(state).toMatchObject({
            player: {
                position: { xMeters: 0, yMeters: 0 },
                noiseRadiusMeters: 0,
                isSneaking: false,
            },
        });
    expect(restored()).toMatchObject({
        combat: { health: 0, bleedingTicks: 1 },
        locations: before,
    });
});

test('failed death commit publishes no transient death or movement and retains the previous save', () => {
    const { step, send, store, onSaveError, restored } = setup();
    vi.spyOn(store, 'saveCombat').mockImplementation(() => {
        throw new Error('death disk failure');
    });
    step();
    vi.advanceTimersByTime(1);
    step();
    expect(send).not.toHaveBeenCalled();
    expect(onSaveError).toHaveBeenCalledOnce();
    expect(restored()).toMatchObject({
        combat: { health: 1, bleedingTicks: 1 },
        position: { xMeters: 0, yMeters: 0 },
    });
});

test('equipment selected while alive and death share one durable step without losing retained items', () => {
    const { dispatch, step, send, store, restored, playerId } = setup();
    const save = vi.spyOn(store, 'saveCombat');
    dispatch('equip-weapon', {
        type: 'equip-weapon',
        protocolVersion: 5,
        meleeVersion: 3,
        itemId: `${playerId}:knife`,
    });
    step();
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
        'health-state',
        expect.objectContaining({ lifeState: 'dead' }),
    );
    expect(send).toHaveBeenCalledWith(
        'pickup-state',
        expect.objectContaining({ hands: { itemId: `${playerId}:knife`, kind: 'knife' } }),
    );
    const saved = restored();
    expect(saved.combat.health).toBe(0);
    expect(saved.locations.find(location => location.type === 'hands')?.item.kind).toBe('knife');
    expect(saved.locations).toHaveLength(store.initialItemLocations.length);
});
