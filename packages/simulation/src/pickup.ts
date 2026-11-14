import { pickupSettings } from '@zombi-survive/content';
import type {
    Corpse,
    InventoryItem,
    ItemLocation,
    PlayerMovementState,
    WorldObstacle,
} from '@zombi-survive/domain';

import { resolveMovement } from './collisions.ts';
import { findInventorySpace } from './inventory.ts';

/** A single synchronous transition removes the ground item and assigns its owner. */
export const pickUpItem = ({
    location,
    player,
    itemId,
    obstacles,
    items = [],
    corpse,
}: {
    readonly corpse?: Corpse;
    readonly location: ItemLocation;
    readonly player: PlayerMovementState;
    readonly itemId: string;
    readonly items?: readonly InventoryItem[];
    readonly obstacles: readonly WorldObstacle[];
}): ItemLocation => {
    const isGround = location.type === 'ground';
    const isCorpse = location.type === 'corpse' && location.corpseId === corpse?.corpseId;

    if ((!isGround && !isCorpse) || location.item.itemId !== itemId) {
        return location;
    }

    const position = location.type === 'ground' ? location.item.position : corpse?.position;

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
        item: { itemId: location.item.itemId, kind: location.item.kind },
        playerId: player.playerId,
    };
};
