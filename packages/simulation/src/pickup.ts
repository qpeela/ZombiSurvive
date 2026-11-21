import { pickupSettings } from '@zombi-survive/content';
import {
    copyItem,
    type Corpse,
    type InventoryItem,
    type ItemLocation,
    type PlayerMovementState,
    type WorldObstacle,
    type WorldPosition,
} from '@zombi-survive/domain';

import { resolveMovement } from './collisions.ts';
import { findInventorySpace } from './inventory.ts';

/** A single synchronous transition moves a world item to its owner. */
export const pickUpItem = ({
    location,
    player,
    itemId,
    obstacles,
    items = [],
    corpse,
    storage,
}: {
    readonly corpse?: Corpse;
    readonly storage?: { readonly storageId: string; readonly position: WorldPosition };
    readonly location: ItemLocation;
    readonly player: PlayerMovementState;
    readonly itemId: string;
    readonly items?: readonly InventoryItem[];
    readonly obstacles: readonly WorldObstacle[];
}): ItemLocation => {
    if (location.item.itemId !== itemId) return location;

    let position: WorldPosition | undefined;
    if (location.type === 'ground') position = location.item.position;
    else if (location.type === 'corpse' && corpse?.corpseId === location.corpseId)
        position = corpse.position;
    else if (location.type === 'storage' && storage?.storageId === location.storageId)
        position = storage.position;

    if (position === undefined) return location;
    const distanceMeters = Math.hypot(
        position.xMeters - player.position.xMeters,
        position.yMeters - player.position.yMeters,
    );

    if (!Number.isFinite(distanceMeters) || distanceMeters > pickupSettings.rangeMeters) {
        return location;
    }

    const reached = resolveMovement(player.position, position, obstacles);
    const isReachable =
        Math.hypot(reached.xMeters - position.xMeters, reached.yMeters - position.yMeters) < 1e-8;

    if (!isReachable) {
        return location;
    }

    const cell = findInventorySpace({ items, item: location.item });

    if (cell === null) {
        return location;
    }

    return {
        type: 'container',
        cell,
        item: copyItem(location.item),
        playerId: player.playerId,
    };
};
