import { randomUUID } from 'node:crypto';

import { type AuthContext, type Client, Room } from '@colyseus/core';
import { movementSettings } from '@zombi-survive/content';
import { initialStateRequest, localWorldRoomId, pickupStateRequest } from '@zombi-survive/protocol';

import { LocalWorldMovement } from './local-world-movement.ts';
import { LocalWorldPickup } from './local-world-pickup.ts';
import type { SoloWorldStore } from './solo-world-store.ts';
import type { WorldAccess } from './world-access.ts';

export class LocalWorldRoom extends Room {
    private readonly pickup = new LocalWorldPickup();
    private movement: LocalWorldMovement | null = null;
    private access: WorldAccess | null = null;
    private saveTimer: ReturnType<typeof setInterval> | undefined;
    private isStopping = false;
    private save: (() => void) | undefined;

    override onCreate(options: {
        access: WorldAccess;
        soloStore?: SoloWorldStore;
        onSaveError: (error: unknown) => void;
    }): void {
        this.roomId = localWorldRoomId;
        this.autoDispose = false;
        this.maxMessagesPerSecond = 20;
        this.maxClients = 16;
        this.access = options.access;

        const saved = options.soloStore?.initialWorld;
        const movement = new LocalWorldMovement(
            saved?.worldId ?? randomUUID(),
            options.access.soloPlayerId,
            saved?.position,
        );
        this.movement = movement;

        if (options.soloStore !== undefined) {
            const store = options.soloStore;
            this.save = () => {
                try {
                    store.savePosition(movement.soloPosition());
                } catch (error) {
                    this.isStopping = true;
                    clearInterval(this.saveTimer);
                    options.onSaveError(error);
                }
            };
            this.saveTimer = setInterval(this.save, 1000);
        }

        this.onMessage(initialStateRequest, client => movement.snapshot(client.sessionId));
        this.onMessage(pickupStateRequest, client =>
            this.pickup.snapshot(movement.snapshot(client.sessionId)),
        );
        this.onMessage<unknown>('pickup-item', (client, value) => {
            this.pickup.receive(client.sessionId, value);
        });
        this.onMessage<unknown>('inventory-move', (client, value) => {
            this.pickup.receiveMove(client.sessionId, value);
        });
        this.onMessage<unknown>('movement-input', (client, value) => {
            movement.receive(client.sessionId, value);
        });
        this.onMessage<unknown>('movement-target', (client, value) => {
            movement.receive(client.sessionId, value);
        });
        this.setTimestep(() => {
            if (this.isStopping) {
                return;
            }

            movement.step();

            const snapshots = new Map(
                this.clients.map(client => [client.sessionId, movement.snapshot(client.sessionId)]),
            );
            this.pickup.step(snapshots);

            for (const client of this.clients) {
                const snapshot = snapshots.get(client.sessionId);

                if (snapshot !== undefined) {
                    client.send('movement-snapshot', snapshot);
                    client.send('pickup-state', this.pickup.snapshot(snapshot));
                }
            }
        }, 1000 / movementSettings.ticksPerSecond);
    }

    override onAuth(_client: Client, _options: unknown, context: AuthContext): string | false {
        return this.access?.authenticate(context.headers) ?? false;
    }

    override onJoin(client: Client): void {
        const playerId: unknown = client.auth;

        if (typeof playerId !== 'string') {
            throw new Error('Player authentication is missing.');
        }

        this.movement?.join(client.sessionId, playerId);
    }

    override onLeave(client: Client): void {
        this.movement?.leave(client.sessionId);
        this.pickup.leave(client.sessionId);
    }

    override onBeforeShutdown(): void {
        if (!this.isStopping) {
            this.isStopping = true;
            this.save?.();
        }

        clearInterval(this.saveTimer);
        super.onBeforeShutdown();
    }

    override onDispose(): void {
        clearInterval(this.saveTimer);
    }
}
