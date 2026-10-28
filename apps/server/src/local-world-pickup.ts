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

import { copyItemLocation } from './saved-item.ts';

export class LocalWorldPickup {
    private location: ItemLocation;
    private readonly requiresCommit: boolean;
    private pendingSave: ItemLocation | null = null;
    private isSaveTaken = false;
    private isSaveComplete = false;
    private readonly pending = new Map<string, PickupCommand | InventoryMoveCommand>();

    constructor(initialLocation?: ItemLocation) {
        this.requiresCommit = initialLocation !== undefined;
        this.location = copyItemLocation(
            initialLocation ?? { type: 'ground', item: initialGroundItem },
        );
    }

    takePendingSave(): ItemLocation | null {
        if (this.pendingSave === null || this.isSaveTaken) {
            return null;
        }

        this.isSaveTaken = true;
        return copyItemLocation(this.pendingSave);
    }

    confirmSave(): void {
        if (this.pendingSave !== null && this.isSaveTaken) {
            this.isSaveComplete = true;
        }
    }

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
        if (this.pendingSave !== null) {
            if (!this.isSaveComplete) {
                return;
            }

            this.location = this.pendingSave;
            this.pendingSave = null;
            this.isSaveTaken = false;
            this.isSaveComplete = false;
        }

        let nextLocation = this.location;

        for (const [sessionId, command] of this.pending) {
            const snapshot = sessions.get(sessionId);

            if (snapshot === undefined) {
                continue;
            }

            if (command.type === 'inventory-move') {
                const location = nextLocation;
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

                    const isMoved =
                        location.cell.column !== command.cell.column ||
                        location.cell.row !== command.cell.row;

                    if (placed !== null && isMoved) {
                        nextLocation = { ...location, cell: { ...command.cell } };
                    }
                }

                continue;
            }

            nextLocation = pickUpItem({
                location: nextLocation,
                player: snapshot.player,
                itemId: command.itemId,
                obstacles: initialWorldChunk.obstacles,
            });
        }

        this.pending.clear();

        if (this.requiresCommit) {
            if (nextLocation !== this.location) {
                this.pendingSave = nextLocation;
            }
        } else {
            this.location = nextLocation;
        }
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
