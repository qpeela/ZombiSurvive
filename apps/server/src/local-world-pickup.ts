import { initialGroundItem } from '@zombi-survive/content';
import type { ItemLocation } from '@zombi-survive/domain';
import {
    type InventoryMoveCommand,
    inventoryVersion,
    isInventoryMoveCommand,
    isPickupCommand,
    type MovementSnapshot,
    type PickupCommand,
    type PickupSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';
import { pickUpItem, placeInventoryItem } from '@zombi-survive/simulation';
import { initialWorldChunk } from '@zombi-survive/worldgen';

export class LocalWorldPickup {
    private location: ItemLocation = { type: 'ground', item: initialGroundItem };
    private readonly pending = new Map<string, PickupCommand | InventoryMoveCommand>();

    receive(sessionId: string, value: unknown): void {
        if (isPickupCommand(value)) {
            this.pending.set(sessionId, {
                type: value.type,
                protocolVersion,
                itemId: value.itemId,
            });
        }
    }

    receiveMove(sessionId: string, value: unknown): void {
        if (isInventoryMoveCommand(value)) {
            this.pending.set(sessionId, {
                type: value.type,
                protocolVersion,
                inventoryVersion,
                itemId: value.itemId,
                cell: { column: value.cell.column, row: value.cell.row },
            });
        }
    }

    leave(sessionId: string): void {
        this.pending.delete(sessionId);
    }

    step(sessions: ReadonlyMap<string, MovementSnapshot>): void {
        for (const [sessionId, command] of this.pending) {
            const snapshot = sessions.get(sessionId);

            if (snapshot === undefined) {
                continue;
            }

            if (command.type === 'inventory-move') {
                const location = this.location;
                const isOwner =
                    location.type === 'container' && location.playerId === snapshot.player.playerId;

                if (
                    location.type === 'container' &&
                    isOwner &&
                    location.item.itemId === command.itemId
                ) {
                    const placed = placeInventoryItem({
                        items: [{ ...location.item, cell: location.cell }],
                        item: location.item,
                        cell: command.cell,
                    });

                    if (placed !== null) {
                        this.location = { ...location, cell: { ...command.cell } };
                    }
                }

                continue;
            }

            this.location = pickUpItem({
                location: this.location,
                player: snapshot.player,
                itemId: command.itemId,
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
            inventoryVersion,
            protocolVersion,
            worldId: movement.worldId,
            playerId: movement.player.playerId,
            tick: movement.tick,
            groundItem:
                location.type === 'ground'
                    ? { ...location.item, position: { ...location.item.position } }
                    : null,
            items: isOwner ? [{ ...location.item, cell: { ...location.cell } }] : [],
        };
    }
}
