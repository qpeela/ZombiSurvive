import { ammoSettings, pistolSettings } from '@zombi-survive/content';
import type { AmmoStack, ItemLocation, PistolItem } from '@zombi-survive/domain';

/** Move existing rounds only; the caller commits every changed instance together. */
export const reloadPistol = ({
    locations,
    playerId,
    itemId,
    revision,
}: {
    locations: readonly ItemLocation[];
    playerId: string;
    itemId: string;
    revision: number;
}): readonly ItemLocation[] => {
    const hands = locations.find(
        location => location.type === 'hands' && location.playerId === playerId,
    );
    if (hands?.type !== 'hands' || hands.item.kind !== 'pistol' || hands.item.itemId !== itemId)
        return locations;
    const pistol = hands.item;
    const current = pistol.revision ?? 0;
    if (current !== revision || current >= Number.MAX_SAFE_INTEGER) return locations;
    let needed = pistolSettings.magazineCapacity - pistol.rounds;
    if (needed <= 0) return locations;
    const changes = new Map<string, ItemLocation>();
    for (const location of [...locations].sort((first, second) =>
        first.item.itemId.localeCompare(second.item.itemId),
    )) {
        if (needed === 0) break;
        if (
            location.type !== 'container' ||
            location.playerId !== playerId ||
            location.item.kind !== 'ammo9mm'
        )
            continue;
        const quantity = location.item.quantity;
        const isQuantity =
            Number.isSafeInteger(quantity) &&
            quantity > 0 &&
            quantity <= ammoSettings.stackQuantity;
        if (!isQuantity) continue;
        const moved = Math.min(needed, quantity);
        const item: AmmoStack = { ...location.item, quantity: quantity - moved };
        changes.set(
            item.itemId,
            item.quantity === 0 ? { type: 'consumed', item } : { ...location, item },
        );
        needed -= moved;
    }
    if (changes.size === 0) return locations;
    const item: PistolItem = {
        ...pistol,
        rounds: pistolSettings.magazineCapacity - needed,
        revision: current + 1,
    };
    changes.set(itemId, { ...hands, item });
    return locations.map(location => changes.get(location.item.itemId) ?? location);
};
