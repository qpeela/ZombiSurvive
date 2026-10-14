import { randomUUID } from 'node:crypto';

import { type Client, Room } from '@colyseus/core';
import { movementSettings } from '@zombi-survive/content';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

import { LocalWorldMovement } from './local-world-movement.ts';

export class LocalWorldRoom extends Room {
    private movement: LocalWorldMovement | null = null;

    override onCreate(): void {
        this.roomId = localWorldRoomId;
        this.autoDispose = false;
        this.maxMessagesPerSecond = 20;

        const movement = new LocalWorldMovement(randomUUID(), randomUUID());
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

    override onJoin(client: Client): void {
        this.movement?.join(client.sessionId);
    }

    override onLeave(client: Client): void {
        this.movement?.leave(client.sessionId);
    }
}
