/// <reference lib="dom" />
import type { MovementSnapshot, PickupSnapshot } from '@zombi-survive/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
    createWorldConnection,
    type WorldConnectionState,
} from '../../apps/client/src/world-connection.ts';

const { join } = vi.hoisted(() => ({ join: vi.fn() }));
vi.mock('@colyseus/sdk', () => ({
    Client: class {
        joinById = join;
    },
    Room: vi.fn(),
}));

const snapshot = (tick: number): MovementSnapshot => ({
    type: 'movement-snapshot',
    protocolVersion: 5,
    worldId: 'world',
    tick,
    player: {
        playerId: 'player',
        stamina: 1,
        isExhausted: false,
        isSneaking: false,
        noiseRadiusMeters: 0,
        position: { xMeters: tick * 0.2, yMeters: 0 },
    },
    lastProcessedInputSequence: null,
    otherPlayers: [],
});
const createRoom = () => {
    let resolveInitial: (value: unknown) => void = () => {};
    const messages = new Map<string, (value: unknown) => void>();
    let onLeave: () => void = () => {};
    const initial = new Promise<unknown>(resolve => {
        resolveInitial = resolve;
    });
    const room = {
        connection: { close: vi.fn() },
        onMessage: (_type: string, callback: (value: unknown) => void) => {
            messages.set(_type, callback);
        },
        onLeave: (callback: () => void) => {
            onLeave = callback;
        },
        onError: vi.fn(),
        request: vi.fn(() => initial),
        send: vi.fn(),
    };

    return {
        room,
        resolveInitial: (value: unknown) => {
            resolveInitial(value);
        },
        publish: (value: unknown) => {
            messages.get('movement-snapshot')?.(value);
        },
        publishPickup: (value: unknown) => {
            messages.get('pickup-state')?.(value);
        },
        publishZombie: (value: unknown) => {
            messages.get('zombie-state')?.(value);
        },
        publishHealth: (value: unknown) => {
            messages.get('health-state')?.(value);
        },
        leave: () => {
            onLeave();
        },
    };
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    join.mockReset();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

test('a late initial reply and older snapshots cannot roll back live position', async () => {
    const fake = createRoom();
    join.mockResolvedValue(fake.room);
    const states: WorldConnectionState[] = [];
    const connection = createWorldConnection('http://host', state => states.push(state));
    const connected = connection.connect();
    await vi.waitFor(() => {
        expect(fake.room.request).toHaveBeenCalled();
    });
    fake.publish(snapshot(5));
    fake.resolveInitial(snapshot(2));
    await connected;

    expect(states.at(-1)).toEqual({ status: 'connected', snapshot: snapshot(5) });
    fake.publish(snapshot(4));
    fake.publish(snapshot(5));
    expect(states).toHaveLength(2);
    fake.publish(snapshot(6));
    expect(states.at(-1)).toEqual({ status: 'connected', snapshot: snapshot(6) });
    connection.dispose();
});

test.each([{}, { ...snapshot(2), worldId: 'foreign-world' }])(
    'malformed or foreign-world updates close the connection and disable input',
    async value => {
        const fake = createRoom();
        join.mockResolvedValue(fake.room);
        const states: WorldConnectionState[] = [];
        const connection = createWorldConnection('http://host', state => states.push(state));
        const connected = connection.connect();
        await vi.waitFor(() => {
            expect(fake.room.request).toHaveBeenCalled();
        });
        fake.resolveInitial(snapshot(1));
        await connected;
        fake.publish(value);
        connection.sendMovement({ x: 1, y: 0 });

        expect(states.at(-1)).toEqual({ status: 'error' });
        expect(fake.room.connection.close).toHaveBeenCalledOnce();
        expect(fake.room.send).not.toHaveBeenCalled();
        connection.dispose();
    },
);

test('a replaced room cannot publish, leave or send held input into the new session', async () => {
    const first = createRoom();
    const second = createRoom();
    join.mockResolvedValueOnce(first.room).mockResolvedValueOnce(second.room);
    const states: WorldConnectionState[] = [];
    const connection = createWorldConnection('http://host', state => states.push(state));
    const initial = connection.connect();
    await vi.waitFor(() => {
        expect(first.room.request).toHaveBeenCalled();
    });
    first.resolveInitial(snapshot(1));
    await initial;
    connection.sendMovement({ x: 1, y: 0 });
    const replacement = connection.connect();
    connection.sendMovement({ x: 1, y: 0 });
    await vi.waitFor(() => {
        expect(second.room.request).toHaveBeenCalled();
    });
    second.resolveInitial(snapshot(10));
    await replacement;
    first.publish(snapshot(20));
    first.leave();

    expect(states.at(-1)).toEqual({ status: 'connected', snapshot: snapshot(10) });
    expect(second.room.send).not.toHaveBeenCalled();
    connection.sendMovement({ x: -1, y: 0 });
    expect(first.room.send.mock.calls[0]?.[1]).toMatchObject({ sequence: 1 });
    expect(second.room.send.mock.calls[0]?.[1]).toMatchObject({ sequence: 1 });
    connection.dispose();
});

test('mouse and keyboard share sequence numbers and cannot send before readiness or after disconnect', async () => {
    const fake = createRoom();
    join.mockResolvedValue(fake.room);
    const onCommandSent = vi.fn();
    const connection = createWorldConnection('http://host', () => {}, onCommandSent);
    connection.sendTarget({ xMeters: 2, yMeters: -1 });
    const ready = connection.connect();
    await vi.waitFor(() => {
        expect(fake.room.request).toHaveBeenCalled();
    });
    connection.sendTarget({ xMeters: 2, yMeters: -1 });
    expect(fake.room.send).not.toHaveBeenCalled();
    expect(onCommandSent).not.toHaveBeenCalled();
    fake.resolveInitial(snapshot(1));
    await ready;
    connection.sendTarget({ xMeters: 2, yMeters: -1 });
    connection.sendMovement({ x: 1, y: 0 });
    expect(fake.room.send.mock.calls).toMatchObject([
        ['movement-target', { sequence: 1, target: { xMeters: 2, yMeters: -1 } }],
        ['movement-input', { sequence: 2, direction: { x: 1, y: 0 } }],
    ]);
    expect(onCommandSent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ type: 'movement-target', sequence: 1 }),
    );
    expect(onCommandSent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ type: 'movement-input', sequence: 2 }),
    );
    connection.disconnect();
    connection.sendTarget({ xMeters: 3, yMeters: 4 });
    expect(fake.room.send).toHaveBeenCalledTimes(2);
    expect(onCommandSent).toHaveBeenCalledTimes(2);
    connection.dispose();
});

const pickupState = (tick: number): PickupSnapshot => ({
    type: 'pickup-state',
    inventoryVersion: 1,
    protocolVersion: 5,
    worldId: 'world',
    playerId: 'player',
    tick,
    groundItem: null,
    items: [{ itemId: 'item', kind: 'bandage', cell: { column: 0, row: 0 } }],
});
test('pickup waits for readiness, ignores stale and replaced rooms, and stops sending on disconnect', async () => {
    const first = createRoom();
    const second = createRoom();
    join.mockResolvedValueOnce(first.room).mockResolvedValueOnce(second.room);
    const onPickup = vi.fn();
    const connection = createWorldConnection('http://host', () => {}, undefined, onPickup);
    connection.pickUp('item');
    connection.moveItem('item', { column: 2, row: 2 });
    const connected = connection.connect();
    await vi.waitFor(() => {
        expect(first.room.request).toHaveBeenCalled();
    });
    first.publishPickup(pickupState(0));
    expect(onPickup).not.toHaveBeenCalled();
    first.resolveInitial(snapshot(1));
    await connected;
    connection.pickUp('item');
    expect(first.room.send).toHaveBeenCalledWith('pickup-item', {
        type: 'pickup-item',
        protocolVersion: 5,
        itemId: 'item',
    });
    connection.moveItem('item', { column: 2, row: 2 });
    expect(first.room.send).toHaveBeenCalledWith('inventory-move', {
        type: 'inventory-move',
        protocolVersion: 5,
        inventoryVersion: 1,
        itemId: 'item',
        cell: { column: 2, row: 2 },
    });
    first.publishPickup(pickupState(2));
    first.publishPickup(pickupState(1));
    expect(onPickup).toHaveBeenCalledOnce();
    const reconnected = connection.connect();
    await vi.waitFor(() => {
        expect(second.room.request).toHaveBeenCalled();
    });
    second.resolveInitial(snapshot(1));
    await reconnected;
    first.publishPickup(pickupState(100));
    second.publishPickup(pickupState(1));
    expect(onPickup).toHaveBeenCalledTimes(2);
    connection.disconnect();
    connection.pickUp('item');
    connection.moveItem('item', { column: 2, row: 2 });
    second.publishPickup(pickupState(2));
    expect(second.room.send).not.toHaveBeenCalled();
    expect(onPickup).toHaveBeenCalledTimes(2);
    connection.dispose();
});

test.each([
    {},
    { ...pickupState(2), worldId: 'other' },
    { ...pickupState(2), playerId: 'other' },
    {
        ...pickupState(2),
        items: [{ itemId: 'item', kind: 'bandage', cell: { column: 3, row: 0 } }],
    },
])('invalid or foreign pickup state closes the connection', async value => {
    const fake = createRoom();
    join.mockResolvedValue(fake.room);
    const states: WorldConnectionState[] = [];
    const connection = createWorldConnection('http://host', state => states.push(state));
    const connected = connection.connect();
    await vi.waitFor(() => {
        expect(fake.room.request).toHaveBeenCalled();
    });
    fake.resolveInitial(snapshot(1));
    await connected;
    fake.publishPickup(value);
    connection.pickUp('item');
    expect(states.at(-1)).toEqual({ status: 'error' });
    expect(fake.room.send).not.toHaveBeenCalled();
    connection.dispose();
});

const zombieState = (tick: number) => ({
    type: 'zombie-state',
    protocolVersion: 5,
    zombieVersion: 1,
    worldId: 'world',
    tick,
    zombies: [
        { zombieId: 'zombie', position: { xMeters: -8, yMeters: 0 }, targetPlayerId: 'player' },
    ],
});
test('zombie updates require readiness and ignore stale ticks and replaced rooms', async () => {
    const first = createRoom();
    const second = createRoom();
    join.mockResolvedValueOnce(first.room).mockResolvedValueOnce(second.room);
    const onZombie = vi.fn();
    const connection = createWorldConnection(
        'http://host',
        () => {},
        undefined,
        undefined,
        onZombie,
    );
    const ready = connection.connect();
    await vi.waitFor(() => {
        expect(first.room.request).toHaveBeenCalled();
    });
    first.publishZombie(zombieState(0));
    expect(onZombie).not.toHaveBeenCalled();
    first.resolveInitial(snapshot(1));
    await ready;
    first.publishZombie(zombieState(2));
    first.publishZombie(zombieState(1));
    expect(onZombie).toHaveBeenCalledOnce();
    const retry = connection.connect();
    await vi.waitFor(() => {
        expect(second.room.request).toHaveBeenCalled();
    });
    second.resolveInitial(snapshot(1));
    await retry;
    first.publishZombie(zombieState(100));
    second.publishZombie(zombieState(1));
    expect(onZombie).toHaveBeenCalledTimes(2);
    connection.disconnect();
    second.publishZombie(zombieState(2));
    expect(onZombie).toHaveBeenCalledTimes(2);
    connection.dispose();
});
test.each([
    {},
    { ...zombieState(2), worldId: 'foreign' },
    { ...zombieState(2), zombies: [{ zombieId: 'zombie' }] },
])('invalid zombie updates close the connection', async value => {
    const fake = createRoom();
    join.mockResolvedValue(fake.room);
    const states: WorldConnectionState[] = [];
    const connection = createWorldConnection('http://host', state => states.push(state));
    const ready = connection.connect();
    await vi.waitFor(() => {
        expect(fake.room.request).toHaveBeenCalled();
    });
    fake.resolveInitial(snapshot(1));
    await ready;
    fake.publishZombie(value);
    expect(states.at(-1)).toEqual({ status: 'error' });
    expect(fake.room.connection.close).toHaveBeenCalledOnce();
    connection.dispose();
});

const healthState = (tick: number, health = 90) => ({
    type: 'health-state',
    protocolVersion: 5,
    healthVersion: 1,
    worldId: 'world',
    playerId: 'player',
    tick,
    health,
    maxHealth: 100,
});
test('health requires readiness and cannot be overwritten by stale ticks, rooms or disconnect', async () => {
    const first = createRoom();
    const second = createRoom();
    join.mockResolvedValueOnce(first.room).mockResolvedValueOnce(second.room);
    const onHealth = vi.fn();
    const connection = createWorldConnection(
        'http://host',
        () => {},
        undefined,
        undefined,
        undefined,
        onHealth,
    );
    const ready = connection.connect();
    await vi.waitFor(() => {
        expect(first.room.request).toHaveBeenCalled();
    });
    first.publishHealth(healthState(0));
    expect(onHealth).not.toHaveBeenCalled();
    first.resolveInitial(snapshot(1));
    await ready;
    first.publishHealth(healthState(2));
    first.publishHealth(healthState(1, 100));
    first.publishHealth(healthState(2, 100));
    expect(onHealth).toHaveBeenCalledOnce();
    expect(onHealth).toHaveBeenLastCalledWith(healthState(2));
    const retry = connection.connect();
    await vi.waitFor(() => {
        expect(second.room.request).toHaveBeenCalled();
    });
    second.resolveInitial(snapshot(1));
    await retry;
    first.publishHealth(healthState(100, 100));
    second.publishHealth(healthState(1, 80));
    expect(onHealth).toHaveBeenCalledTimes(2);
    expect(onHealth).toHaveBeenLastCalledWith(healthState(1, 80));
    connection.disconnect();
    second.publishHealth(healthState(2));
    expect(onHealth).toHaveBeenCalledTimes(2);
    connection.dispose();
});
test.each([
    {},
    { ...healthState(2), worldId: 'foreign' },
    { ...healthState(2), playerId: 'foreign' },
    { ...healthState(2), health: 101 },
])('invalid or foreign health updates close the connection: %j', async value => {
    const fake = createRoom();
    join.mockResolvedValue(fake.room);
    const states: WorldConnectionState[] = [];
    const connection = createWorldConnection('http://host', state => states.push(state));
    const ready = connection.connect();
    await vi.waitFor(() => {
        expect(fake.room.request).toHaveBeenCalled();
    });
    fake.resolveInitial(snapshot(1));
    await ready;
    fake.publishHealth(value);
    expect(states.at(-1)).toEqual({ status: 'error' });
    expect(fake.room.connection.close).toHaveBeenCalledOnce();
    connection.dispose();
});
