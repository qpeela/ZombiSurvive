import { initialGroundItem } from '@zombi-survive/content';
import { isMeleeWeaponId, type ItemLocation, type MeleeWeaponId } from '@zombi-survive/domain';
import {
    type InventoryMoveCommand,
    inventoryVersion,
    isInventoryMoveCommand,
    isMeleeCommand,
    isPickupCommand,
    type MeleeCommand,
    type MovementSnapshot,
    type PickupCommand,
    type PickupSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';
import {
    addStarterWeapons,
    pickUpItem,
    placeInventoryItem,
    playerHands,
    playerInventory,
    transferWeapon,
} from '@zombi-survive/simulation';
import { initialWorldChunk } from '@zombi-survive/worldgen';

import { copyItemLocation } from './saved-item.ts';

type ItemCommand =
    PickupCommand | InventoryMoveCommand | Exclude<MeleeCommand, { type: 'melee-attack' }>;

export class LocalWorldPickup {
    private locations: readonly ItemLocation[];
    private readonly requiresCommit: boolean;
    private pendingSave: readonly ItemLocation[] | null = null;
    private isSaveTaken = false;
    private isSaveComplete = false;
    private readonly initializedPlayers = new Set<string>();
    private readonly pending = new Map<string, ItemCommand>();

    constructor(initialLocations?: readonly ItemLocation[]) {
        this.requiresCommit = initialLocations !== undefined;
        this.locations = (initialLocations ?? [{ type: 'ground', item: initialGroundItem }]).map(
            copyItemLocation,
        );
    }

    initializePlayer(playerId: string): void {
        if (this.requiresCommit || this.initializedPlayers.has(playerId)) return;

        this.locations = addStarterWeapons(this.locations, playerId);
        this.initializedPlayers.add(playerId);
    }

    takePendingSave(): readonly ItemLocation[] | null {
        if (this.pendingSave === null || this.isSaveTaken) return null;

        this.isSaveTaken = true;

        return this.pendingSave.map(copyItemLocation);
    }

    confirmSave(): void {
        if (this.pendingSave !== null && this.isSaveTaken) this.isSaveComplete = true;
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
                cell: { ...value.cell },
            });
        }
    }

    receiveEquipment(sessionId: string, value: unknown): void {
        if (isMeleeCommand(value) && value.type !== 'melee-attack') {
            this.pending.set(sessionId, { ...value });
        }
    }

    leave(sessionId: string): void {
        this.pending.delete(sessionId);
    }

    step(
        sessions: ReadonlyMap<string, MovementSnapshot>,
        health: (snapshot: MovementSnapshot) => number = () => 100,
    ): void {
        if (this.pendingSave !== null) {
            if (!this.isSaveComplete) return;

            this.locations = this.pendingSave;
            this.pendingSave = null;
            this.isSaveTaken = false;
            this.isSaveComplete = false;
        }

        let next = this.locations;

        for (const [sessionId, command] of this.pending) {
            const snapshot = sessions.get(sessionId);

            if (snapshot === undefined) continue;

            const playerId = snapshot.player.playerId;
            const items = playerInventory(next, playerId);

            if (command.type === 'equip-weapon' || command.type === 'unequip-weapon') {
                if (health(snapshot) > 0)
                    next = transferWeapon({
                        locations: next,
                        playerId,
                        itemId: command.itemId,
                        type: command.type,
                    });

                continue;
            }

            const location = next.find(candidate => candidate.item.itemId === command.itemId);

            if (location === undefined) continue;

            if (command.type === 'inventory-move') {
                const isOwner = location.type === 'container' && location.playerId === playerId;

                if (location.type !== 'container' || !isOwner) continue;

                const placed = placeInventoryItem({
                    items,
                    item: location.item,
                    cell: command.cell,
                });
                const isMoved =
                    location.cell.column !== command.cell.column ||
                    location.cell.row !== command.cell.row;

                if (placed !== null && isMoved) {
                    next = next.map(candidate =>
                        candidate === location
                            ? { ...location, cell: { ...command.cell } }
                            : candidate,
                    );
                }

                continue;
            }

            const picked = pickUpItem({
                location,
                player: snapshot.player,
                itemId: command.itemId,
                obstacles: initialWorldChunk.obstacles,
                items,
            });

            if (picked !== location)
                next = next.map(candidate => (candidate === location ? picked : candidate));
        }

        this.pending.clear();

        if (this.requiresCommit) {
            if (next !== this.locations) this.pendingSave = next;
        } else {
            this.locations = next;
        }
    }

    weapon(movement: MovementSnapshot): MeleeWeaponId | null {
        const hands = playerHands(this.locations, movement.player.playerId);

        return hands !== null && isMeleeWeaponId(hands.kind) ? hands.kind : null;
    }

    snapshot(movement: MovementSnapshot): PickupSnapshot {
        const ground = this.locations.find(location => location.type === 'ground');
        const playerId = movement.player.playerId;

        return {
            type: 'pickup-state',
            inventoryVersion,
            protocolVersion,
            worldId: movement.worldId,
            playerId,
            tick: movement.tick,
            groundItem:
                ground?.type === 'ground'
                    ? { ...ground.item, position: { ...ground.item.position } }
                    : null,
            items: playerInventory(this.locations, playerId),
            hands: playerHands(this.locations, playerId),
        };
    }
}
