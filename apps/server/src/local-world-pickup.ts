import { initialGroundItem, worldLootSettings } from '@zombi-survive/content';
import {
    type Corpse,
    isWeaponId,
    type Item,
    type ItemLocation,
    type WeaponId,
} from '@zombi-survive/domain';
import {
    type InventoryMoveCommand,
    inventoryVersion,
    isInventoryMoveCommand,
    isMeleeCommand,
    isPickupCommand,
    isUseBandageCommand,
    type MeleeCommand,
    type MovementSnapshot,
    type PickupCommand,
    type PickupSnapshot,
    protocolVersion,
    type UseBandageCommand,
} from '@zombi-survive/protocol';
import {
    addStarterWeapons,
    equipmentWeightGrams,
    expireCorpses,
    pickUpItem,
    placeInventoryItem,
    playerHands,
    playerInventory,
    transferWeapon,
} from '@zombi-survive/simulation';
import { loadWorldChunks } from '@zombi-survive/worldgen';

import { copyItemLocation } from './saved-item.ts';

type ItemCommand =
    | PickupCommand
    | InventoryMoveCommand
    | UseBandageCommand
    | Exclude<MeleeCommand, { type: 'melee-attack' }>;

export class LocalWorldPickup {
    private locations: readonly ItemLocation[];
    private readonly requiresCommit: boolean;
    private pendingSave: readonly ItemLocation[] | null = null;
    private isSaveTaken = false;
    private readonly initializedPlayers = new Set<string>();
    private readonly pending = new Map<string, ItemCommand>();

    private corpses: readonly Corpse[] = [];
    private readonly now: () => number;

    constructor(
        initialLocations?: readonly ItemLocation[],
        corpses: readonly Corpse[] = [],
        now: () => number = Date.now,
    ) {
        this.now = now;
        this.setCorpses(corpses);
        this.requiresCommit = initialLocations !== undefined;
        this.locations = (initialLocations ?? [{ type: 'ground', item: initialGroundItem }]).map(
            copyItemLocation,
        );
    }

    setCorpses(corpses: readonly Corpse[]): void {
        this.corpses = corpses.map(corpse => ({ ...corpse, position: { ...corpse.position } }));
    }

    stageExpiry(nowMs: number): readonly Corpse[] | null {
        if (this.pendingSave !== null) return null;
        const result = expireCorpses({ corpses: this.corpses, locations: this.locations, nowMs });
        if (result === null) return null;
        if (this.requiresCommit) this.pendingSave = result.locations;
        else {
            this.locations = result.locations;
            this.setCorpses(result.corpses);
        }
        return result.corpses;
    }

    stageDeath(corpse: Corpse): void {
        const source = this.pendingSave ?? this.locations;
        const next = source.map(location => {
            const isOwned =
                (location.type === 'container' || location.type === 'hands') &&
                location.playerId === corpse.playerId;
            return isOwned
                ? { type: 'corpse' as const, corpseId: corpse.corpseId, item: { ...location.item } }
                : location;
        });
        if (this.requiresCommit) this.pendingSave = next;
        else this.locations = next;
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
        if (this.pendingSave === null || !this.isSaveTaken) return;

        this.locations = this.pendingSave;
        this.pendingSave = null;
        this.isSaveTaken = false;
    }

    receiveUseBandage(sessionId: string, value: unknown): void {
        if (isUseBandageCommand(value)) {
            this.pending.set(sessionId, {
                type: value.type,
                protocolVersion,
                inventoryVersion,
                itemId: value.itemId,
            });
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
        useBandage: (input: {
            readonly snapshot: MovementSnapshot;
            readonly locations: readonly ItemLocation[];
            readonly itemId: string;
        }) => readonly ItemLocation[] = input => input.locations,
    ): void {
        if (this.pendingSave !== null) return;

        let next = this.locations;

        for (const [sessionId, command] of this.pending) {
            const snapshot = sessions.get(sessionId);

            if (snapshot === undefined) continue;

            if (health(snapshot) <= 0) continue;

            const playerId = snapshot.player.playerId;
            const items = playerInventory(next, playerId);

            if (command.type === 'use-bandage') {
                next = useBandage({ snapshot, locations: next, itemId: command.itemId });

                continue;
            }

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

            const corpse =
                location.type === 'corpse'
                    ? this.corpses.find(candidate => {
                          const isTarget = candidate.corpseId === location.corpseId;
                          const isAvailable = candidate.expiresAtMs > this.now();
                          return isTarget && isAvailable;
                      })
                    : undefined;
            const sourcePosition =
                location.type === 'ground'
                    ? location.item.position
                    : (corpse?.position ?? snapshot.player.position);
            const picked = pickUpItem({
                ...(corpse === undefined ? {} : { corpse }),
                location,
                player: snapshot.player,
                itemId: command.itemId,
                obstacles: loadWorldChunks({
                    positions: [snapshot.player.position, sourcePosition],
                    previousChunks: [],
                }).flatMap(chunk => chunk.obstacles),
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

    hands(playerId: string): Item | null {
        return playerHands(this.locations, playerId);
    }

    stagedLocations(): readonly ItemLocation[] {
        return (this.pendingSave ?? this.locations).map(copyItemLocation);
    }

    stageLocations(locations: readonly ItemLocation[]): void {
        const next = locations.map(copyItemLocation);
        if (this.requiresCommit) this.pendingSave = next;
        else this.locations = next;
    }

    stageItem(item: Item): void {
        const source = this.pendingSave ?? this.locations;
        const next = source.map(location => {
            if (location.item.itemId !== item.itemId || location.type === 'consumed')
                return location;
            if (location.type === 'ground')
                return { ...location, item: { ...item, position: { ...location.item.position } } };
            return { ...location, item: { ...item } };
        });
        if (this.requiresCommit) this.pendingSave = next;
        else this.locations = next;
    }

    weightGrams(playerId: string): number {
        return equipmentWeightGrams({
            items: playerInventory(this.locations, playerId),
            hands: playerHands(this.locations, playerId),
        });
    }

    weapon(movement: MovementSnapshot): WeaponId | null {
        const hands = playerHands(this.locations, movement.player.playerId);

        return hands !== null && isWeaponId(hands.kind) ? hands.kind : null;
    }

    snapshot(movement: MovementSnapshot): PickupSnapshot {
        const position = movement.player.position;
        const nowMs = this.now();
        const distance = (item: {
            readonly position: { readonly xMeters: number; readonly yMeters: number };
        }): number =>
            Math.hypot(
                item.position.xMeters - position.xMeters,
                item.position.yMeters - position.yMeters,
            );
        const ground = this.locations
            .filter(location => location.type === 'ground')
            .filter(location => distance(location.item) <= worldLootSettings.visibilityMeters)
            .sort((first, second) => distance(first.item) - distance(second.item))[0];
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
            corpses: this.corpses
                .filter(
                    corpse =>
                        corpse.expiresAtMs > nowMs &&
                        distance(corpse) <= worldLootSettings.visibilityMeters,
                )
                .sort((first, second) => distance(first) - distance(second))
                .slice(0, 128)
                .map(corpse => ({
                    ...corpse,
                    position: { ...corpse.position },
                    items: this.locations.flatMap(location =>
                        location.type === 'corpse' && location.corpseId === corpse.corpseId
                            ? [{ ...location.item }]
                            : [],
                    ),
                })),
        };
    }
}
