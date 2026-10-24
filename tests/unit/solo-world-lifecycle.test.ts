import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Room } from '@colyseus/core';
import { afterEach, expect, test, vi } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldRoom } from '../../apps/server/src/local-world-room.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test('restored solo state starts idle with fresh ack, loads neighbours and detaches positions', () => {
    const position = { xMeters: 64, yMeters: -64 };
    const movement = new LocalWorldMovement('saved-world', 'saved-player', position);
    position.xMeters = 999;
    expect(movement.soloPosition()).toEqual({ xMeters: 64, yMeters: -64 });
    const access = new WorldAccess(false, 4000, 0, 'saved-player');
    expect(access.authenticate(new Headers({ 'x-forwarded-for': 'another-ip' }))).toBe(
        'saved-player',
    );
    movement.join('new-session');
    for (let tick = 0; tick < 30; tick++) movement.step();
    expect(movement.snapshot('new-session')).toMatchObject({
        worldId: 'saved-world',
        lastProcessedInputSequence: null,
        player: {
            playerId: 'saved-player',
            position: { xMeters: 64, yMeters: -64 },
            stamina: 1,
            isSneaking: false,
            noiseRadiusMeters: 0,
        },
    });
    Object.assign(movement.soloPosition(), { xMeters: 999 });
    movement.receive('new-session', {
        type: 'movement-target',
        protocolVersion: 5,
        sequence: 1,
        target: { xMeters: 100, yMeters: -64 },
        isSprinting: false,
        isSneaking: false,
    });
    for (let tick = 0; tick < 50; tick++) {
        movement.receive('new-session', {
            type: 'movement-target',
            protocolVersion: 5,
            sequence: tick + 2,
            target: { xMeters: 100, yMeters: -64 },
            isSprinting: false,
            isSneaking: false,
        });
        movement.step();
    }
    expect(movement.soloPosition()).toEqual({ xMeters: 68.65, yMeters: -64 });
});

test.each(['periodic', 'shutdown'] as const)(
    '%s save failure is reported and stops further writes',
    kind => {
        vi.useFakeTimers();
        const directory = mkdtempSync(join(tmpdir(), 'zombi-room-save-'));
        const store = new SoloWorldStore(join(directory, 'world.sqlite'));
        const room = new LocalWorldRoom();
        const onSaveError = vi.fn();
        vi.spyOn(room, 'setTimestep').mockImplementation(() => room);
        vi.spyOn(Room.prototype, 'onBeforeShutdown').mockImplementation(() => undefined);
        const save = vi.spyOn(store, 'savePosition').mockImplementation(() => {
            throw new Error('disk full');
        });

        try {
            room.onCreate({ access: new WorldAccess(false, 4000), soloStore: store, onSaveError });
            if (kind === 'periodic') vi.advanceTimersByTime(1000);
            else room.onBeforeShutdown();
            expect(onSaveError).toHaveBeenCalledWith(new Error('disk full'));
            room.onBeforeShutdown();
            vi.advanceTimersByTime(3000);
            expect(save).toHaveBeenCalledTimes(1);
        } finally {
            room.onDispose();
            store.close();
            rmSync(directory, { recursive: true, force: true });
        }
    },
);

test('a restored world stays saved without clients and shutdown cancels the periodic timer', () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'zombi-idle-save-'));
    const path = join(directory, 'world.sqlite');
    const original = new SoloWorldStore(path);
    original.savePosition({ xMeters: 64, yMeters: -64 });
    original.close();
    const store = new SoloWorldStore(path);
    const room = new LocalWorldRoom();
    vi.spyOn(room, 'setTimestep').mockImplementation(() => room);
    vi.spyOn(Room.prototype, 'onBeforeShutdown').mockImplementation(() => undefined);
    const save = vi.spyOn(store, 'savePosition');

    try {
        room.onCreate({
            access: new WorldAccess(false, 4000, 0, store.initialWorld.playerId),
            soloStore: store,
            onSaveError: error => {
                throw error;
            },
        });
        vi.advanceTimersByTime(999);
        expect(save).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(save).toHaveBeenLastCalledWith({ xMeters: 64, yMeters: -64 });
        room.onBeforeShutdown();
        vi.advanceTimersByTime(3000);
        expect(save).toHaveBeenCalledTimes(2);
        store.close();
        const restored = new SoloWorldStore(path);
        expect(restored.initialWorld.position).toEqual({ xMeters: 64, yMeters: -64 });
        restored.close();
    } finally {
        room.onDispose();
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
