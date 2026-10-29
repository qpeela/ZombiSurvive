import { inventorySettings } from '@zombi-survive/content';
import {
    type InventoryItem,
    isMeleeWeaponId,
    type Item,
    type ItemLocation,
} from '@zombi-survive/domain';

import { findInventorySpace, placeInventoryItem } from './inventory.ts';

export const playerInventory = (
    locations: readonly ItemLocation[],
    playerId: string,
): readonly InventoryItem[] =>
    locations.flatMap(location =>
        location.type === 'container' && location.playerId === playerId
            ? [{ ...location.item, cell: { ...location.cell } }]
            : [],
    );

export const playerHands = (locations: readonly ItemLocation[], playerId: string): Item | null => {
    const hands = locations.find(
        location => location.type === 'hands' && location.playerId === playerId,
    );

    return hands === undefined ? null : { ...hands.item };
};

/** Replays must name the same instance. Every rejected transfer keeps the input intact. */
export const transferWeapon = ({
    locations,
    playerId,
    itemId,
    type,
}: {
    readonly locations: readonly ItemLocation[];
    readonly playerId: string;
    readonly itemId: string;
    readonly type: 'equip-weapon' | 'unequip-weapon';
}): readonly ItemLocation[] => {
    const target = locations.find(location => location.item.itemId === itemId);
    const sourceType = type === 'equip-weapon' ? 'container' : 'hands';
    const isOwned =
        target !== undefined && target.type !== 'ground' && target.playerId === playerId;

    if (
        target === undefined ||
        target.type !== sourceType ||
        !isOwned ||
        !isMeleeWeaponId(target.item.kind)
    ) {
        return locations;
    }

    const hands = playerHands(locations, playerId);
    let next = locations.filter(location => location !== target);
    const returning = type === 'unequip-weapon' ? target.item : hands;

    if (returning !== null) {
        const items = playerInventory(next, playerId);
        const cell = findInventorySpace({ items, item: returning });

        if (cell === null) {
            return locations;
        }

        next = next.filter(location => location.item.itemId !== returning.itemId);
        next.push({ type: 'container', playerId, item: { ...returning }, cell });
    }

    if (type === 'equip-weapon') {
        next.push({ type: 'hands', playerId, item: { ...target.item } });
    }

    return next;
};

/** Only creation/migration calls this. Preserve every previously collected cell. */
export const addStarterWeapons = (
    locations: readonly ItemLocation[],
    playerId: string,
): readonly ItemLocation[] => {
    let next = [...locations];

    for (const kind of ['club', 'knife', 'crowbar', 'axe'] as const) {
        const item: Item = { itemId: `${playerId}:${kind}`, kind };
        let placed: readonly InventoryItem[] | null = null;

        // Prefer the middle row so the former bandage pickup/move cells remain free.
        for (const row of [1, 2, 0]) {
            for (let column = 0; column < inventorySettings.columns; column++) {
                placed = placeInventoryItem({
                    items: playerInventory(next, playerId),
                    item,
                    cell: { column, row },
                });

                if (placed !== null) break;
            }

            if (placed !== null) break;
        }

        const added = placed?.find(candidate => candidate.itemId === item.itemId);

        if (added === undefined) {
            throw new Error('Starter weapons do not fit the existing inventory.');
        }

        next = [...next, { type: 'container', playerId, item, cell: added.cell }];
    }

    return next;
};
