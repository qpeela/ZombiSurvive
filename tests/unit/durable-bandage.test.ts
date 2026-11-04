import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Client, Room } from '@colyseus/core';
import { isPickupSnapshot } from '@zombi-survive/protocol';
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
    const directory = mkdtempSync(join(tmpdir(), 'zombi-bandage-step-'));
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
        const saved = { combat: loaded.initialCombat, locations: loaded.initialItemLocations };
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

test('racing tabs consume once before lethal bleeding; both snapshots share the committed tick', () => {
    const { step, use, send, store, restored } = setup();
    const save = vi.spyOn(store, 'saveCombat');
    use();
    step();
    step();
    expect(save).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
        'health-state',
        expect.objectContaining({ tick: 1, health: 1, bleedingTicks: 0 }),
    );
    const pickups = send.mock.calls.filter(([type]) => type === 'pickup-state');
    expect(pickups).toHaveLength(2);
    for (const [, state] of pickups) {
        if (!isPickupSnapshot(state)) throw new Error('Invalid pickup snapshot.');
        expect(state.tick).toBe(1);
        expect(state.items.some(item => item.kind === 'bandage')).toBe(false);
    }
    use();
    step();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
    const saved = restored();
    expect(saved.combat).toEqual({ health: 1, cooldownTicks: 0, bleedingTicks: 0 });
    expect(saved.locations.some(location => location.item.kind === 'bandage')).toBe(false);
});

test.each([
    { health: 0, bleedingTicks: 1, hasBandage: true },
    { health: 70, bleedingTicks: 0, hasBandage: true },
    { health: 1, bleedingTicks: 1, hasBandage: false },
])('rejected use cannot spend an item or prevent legitimate damage: %j', input => {
    const { use, step, restored } = setup(input);
    use();
    step();
    vi.advanceTimersByTime(1);
    const saved = restored();
    expect(saved.locations.some(location => location.item.kind === 'bandage')).toBe(
        input.hasBandage,
    );
    expect(saved.combat.health).toBe(input.hasBandage ? input.health : 0);
    expect(saved.combat.bleedingTicks).toBe(input.hasBandage ? input.bleedingTicks : 100);
});

test('failed atomic bandage commit publishes nothing and retains both the item and wound', () => {
    const { use, step, send, store, onSaveError, restored } = setup();
    vi.spyOn(store, 'saveCombat').mockImplementation(() => {
        throw new Error('disk full');
    });
    use();
    step();
    vi.advanceTimersByTime(1);
    expect(onSaveError).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    step();
    const saved = restored();
    expect(saved.combat).toEqual({ health: 1, cooldownTicks: 0, bleedingTicks: 1 });
    expect(saved.locations.some(location => location.item.kind === 'bandage')).toBe(true);
});

test('a zombie hit later in the same step can open a new wound after successful treatment', () => {
    const { playerId, use, step, restored } = setup({ health: 50, bleedingTicks: 100 });
    vi.spyOn(LocalWorldZombie.prototype, 'step').mockReturnValue({
        zombies: [
            { zombieId: 'z', targetPlayerId: playerId, position: { xMeters: 0.9, yMeters: 0 } },
        ],
        obstacles: [],
    });
    vi.spyOn(LocalWorldZombie.prototype, 'isAlive').mockReturnValue(true);
    // The twentieth consecutive attack step lands. Apply just before that hit.
    for (let tick = 0; tick < 19; tick++) {
        step();
        vi.advanceTimersByTime(1);
    }
    use();
    step();
    vi.advanceTimersByTime(1);
    const saved = restored();
    expect(saved.combat).toEqual({ health: 40, cooldownTicks: 0, bleedingTicks: 100 });
    expect(saved.locations.some(location => location.item.kind === 'bandage')).toBe(false);
});

test('treatment and equipment commit together without changing the already computed melee action', () => {
    const { dispatch, step, send, playerId, restored } = setup({ health: 70, bleedingTicks: 100 });
    const equip = (kind: string) => {
        dispatch('equip-weapon', {
            type: 'equip-weapon',
            protocolVersion: 5,
            meleeVersion: 3,
            itemId: `${playerId}:${kind}`,
        });
    };
    equip('knife');
    step();
    vi.advanceTimersByTime(1);
    send.mockClear();
    equip('axe');
    dispatch(
        'use-bandage',
        { type: 'use-bandage', protocolVersion: 5, inventoryVersion: 2, itemId: 'starter-bandage' },
        1,
    );
    dispatch('melee-attack', { type: 'melee-attack', protocolVersion: 5, meleeVersion: 3 });
    step();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith(
        'health-state',
        expect.objectContaining({ health: 70, bleedingTicks: 0 }),
    );
    expect(send).toHaveBeenCalledWith('melee-state', expect.objectContaining({ weapon: 'knife' }));
    expect(send).toHaveBeenCalledWith('melee-action', expect.objectContaining({ weapon: 'knife' }));
    expect(send).toHaveBeenCalledWith(
        'pickup-state',
        expect.objectContaining({ hands: { itemId: `${playerId}:axe`, kind: 'axe' } }),
    );
    send.mockClear();
    step();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith('melee-state', expect.objectContaining({ weapon: 'axe' }));
    const saved = restored();
    expect(saved.combat).toMatchObject({ health: 70, bleedingTicks: 0 });
    expect(saved.locations.some(location => location.item.kind === 'bandage')).toBe(false);
    expect(saved.locations.find(location => location.type === 'hands')?.item.kind).toBe('axe');
});
