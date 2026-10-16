/// <reference lib="dom" />
import type { MovementSnapshot } from '@zombi-survive/protocol';
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
    protocolVersion: 3,
    worldId: 'world',
    tick,
    player: { playerId: 'player', position: { xMeters: tick * 0.2, yMeters: 0 } },
    lastProcessedInputSequence: null,
    otherPlayers: [],
});
const createRoom = () => {
    let resolveInitial: (value: unknown) => void = () => {};
    let onSnapshot: (value: unknown) => void = () => {};
    let onLeave: () => void = () => {};
    const initial = new Promise<unknown>(resolve => {
        resolveInitial = resolve;
    });
    const room = {
        connection: { close: vi.fn() },
        onMessage: (_type: string, callback: (value: unknown) => void) => {
            onSnapshot = callback;
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
            onSnapshot(value);
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
    const connection = createWorldConnection('http://host', () => {});
    connection.sendTarget({ xMeters: 2, yMeters: -1 });
    const ready = connection.connect();
    await vi.waitFor(() => {
        expect(fake.room.request).toHaveBeenCalled();
    });
    connection.sendTarget({ xMeters: 2, yMeters: -1 });
    expect(fake.room.send).not.toHaveBeenCalled();
    fake.resolveInitial(snapshot(1));
    await ready;
    connection.sendTarget({ xMeters: 2, yMeters: -1 });
    connection.sendMovement({ x: 1, y: 0 });
    expect(fake.room.send.mock.calls).toMatchObject([
        ['movement-target', { sequence: 1, target: { xMeters: 2, yMeters: -1 } }],
        ['movement-input', { sequence: 2, direction: { x: 1, y: 0 } }],
    ]);
    connection.disconnect();
    connection.sendTarget({ xMeters: 3, yMeters: 4 });
    expect(fake.room.send).toHaveBeenCalledTimes(2);
    connection.dispose();
});
