import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Client } from '@colyseus/core';
import { lootRestockSettings } from '@zombi-survive/content';
import { pickupStateRequest, protocolVersion } from '@zombi-survive/protocol';
import { afterEach, expect, test, vi } from 'vitest';

import { LocalWorldRoom } from '../../apps/server/src/local-world-room.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

for (const isFailed of [false, true]) {
    test(`a pickup request cannot expose an uncommitted timer (write failure: ${String(isFailed)})`, () => {
        vi.useFakeTimers();
        const directory = mkdtempSync(join(tmpdir(), 'zombi-timer-barrier-'));
        const path = join(directory, 'world.sqlite');
        const seed = new SoloWorldStore(path);
        const ammo = seed.lootPoints().find(item => item.kind === 'ammo9mm');
        if (ammo === undefined) throw new Error('Missing ammo point.');
        seed.savePosition(ammo.position);
        seed.saveItemLocations(
            seed.initialItemLocations.map(location =>
                location.type === 'container' ? { type: 'expired', item: location.item } : location,
            ),
        );
        seed.close();
        const store = new SoloWorldStore(path);
        const room = new LocalWorldRoom();
        let step = () => {};
        vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
            step = () => callback?.(50);
        });
        const handlers = new Map<string, (client: Client, value: unknown) => unknown>();
        vi.spyOn(room, 'onMessage').mockImplementation((type, handler: unknown) => {
            if (typeof type === 'string' && typeof handler === 'function')
                handlers.set(type, handler as (client: Client, value: unknown) => unknown);
            return () => {};
        });
        const failed = vi.fn();
        try {
            room.onCreate({
                access: new WorldAccess(false, 4000, 0, store.initialWorld.playerId),
                soloStore: store,
                onSaveError: failed,
            });
            const send = vi.fn<(type: string, value: unknown) => void>();
            const client = {
                sessionId: 'first',
                auth: store.initialWorld.playerId,
                send,
            } as unknown as Client;
            room.clients.push(client);
            room.onJoin(client);
            step();
            vi.advanceTimersByTime(1);
            send.mockClear();
            if (isFailed)
                vi.spyOn(store, 'saveCombat').mockImplementation(() => {
                    throw new Error('timer failure');
                });
            handlers.get('pickup-item')?.(client, {
                type: 'pickup-item',
                protocolVersion,
                itemId: ammo.itemId,
            });
            step();
            expect(send).not.toHaveBeenCalled();
            expect(handlers.get(pickupStateRequest)?.(client, undefined)).toMatchObject({
                restocks: [],
                items: [],
            });
            vi.advanceTimersByTime(1);
            if (isFailed) {
                expect(failed).toHaveBeenCalledOnce();
                expect(send).not.toHaveBeenCalled();
                expect(handlers.get(pickupStateRequest)?.(client, undefined)).toMatchObject({
                    restocks: [],
                    items: [],
                });
            } else {
                expect(failed).not.toHaveBeenCalled();
                expect(handlers.get(pickupStateRequest)?.(client, undefined)).toMatchObject({
                    restocks: [
                        {
                            pointId: ammo.itemId,
                            readyAtWorldMs: 6000 + lootRestockSettings.periodWorldMs,
                        },
                    ],
                });
            }
        } finally {
            room.onDispose();
            store.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
