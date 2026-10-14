import { randomUUID } from 'node:crypto';

import { Room } from '@colyseus/core';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

import { createMovementSnapshot } from './movement-contract.ts';

export class LocalWorldRoom extends Room {
    override onCreate(): void {
        this.roomId = localWorldRoomId;
        this.autoDispose = false;
        this.maxMessagesPerSecond = 20;

        const worldId = randomUUID();
        const player = {
            playerId: randomUUID(),
            position: { xMeters: 0, yMeters: 0 },
        };

        this.onMessage(initialStateRequest, () => createMovementSnapshot(worldId, 0, player, null));
    }
}
