import { initialGroundItem } from '@zombi-survive/content';
import type { ItemLocation } from '@zombi-survive/domain';
import {
    isPickupCommand,
    type MovementSnapshot,
    type PickupSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';
import { pickUpItem } from '@zombi-survive/simulation';
import { initialWorldChunk } from '@zombi-survive/worldgen';

export class LocalWorldPickup {
    private location: ItemLocation = { type: 'ground', item: initialGroundItem };
    private readonly pending = new Map<string, string>();

    receive(sessionId: string, value: unknown): void {
        if (isPickupCommand(value)) {
            this.pending.set(sessionId, value.itemId);
        }
    }

    leave(sessionId: string): void {
        this.pending.delete(sessionId);
    }

    step(sessions: ReadonlyMap<string, MovementSnapshot>): void {
        for (const [sessionId, itemId] of this.pending) {
            const snapshot = sessions.get(sessionId);

            if (snapshot === undefined || this.location.type !== 'ground') {
                continue;
            }

            this.location = pickUpItem({
                location: this.location,
                player: snapshot.player,
                itemId,
                obstacles: initialWorldChunk.obstacles,
            });
        }

        this.pending.clear();
    }

    snapshot(movement: MovementSnapshot): PickupSnapshot {
        const location = this.location;
        const isOwner =
            location.type === 'container' && location.playerId === movement.player.playerId;

        return {
            type: 'pickup-state',
            protocolVersion,
            worldId: movement.worldId,
            playerId: movement.player.playerId,
            tick: movement.tick,
            groundItem:
                location.type === 'ground'
                    ? { ...location.item, position: { ...location.item.position } }
                    : null,
            items: isOwner ? [{ ...location.item }] : [],
        };
    }
}
