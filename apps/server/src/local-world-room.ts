import { randomUUID } from 'node:crypto';

import { type AuthContext, type Client, Room } from '@colyseus/core';
import { movementSettings } from '@zombi-survive/content';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

import { LocalWorldMovement } from './local-world-movement.ts';
import type { WorldAccess } from './world-access.ts';

export class LocalWorldRoom extends Room {
    private movement: LocalWorldMovement | null = null;
    private access: WorldAccess | null = null;

    override onCreate(options: { access: WorldAccess }): void {
        this.roomId = localWorldRoomId;
        this.autoDispose = false;
        this.maxMessagesPerSecond = 20;
        this.maxClients = 16;
        this.access = options.access;

        const movement = new LocalWorldMovement(randomUUID(), options.access.soloPlayerId);
        this.movement = movement;

        this.onMessage(initialStateRequest, client => movement.snapshot(client.sessionId));
        this.onMessage<unknown>('movement-input', (client, value) => {
            movement.receive(client.sessionId, value);
        });
        this.setTimestep(() => {
            movement.step();

            for (const client of this.clients) {
                client.send('movement-snapshot', movement.snapshot(client.sessionId));
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
    }
}
