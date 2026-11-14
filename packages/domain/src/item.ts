import type { WorldPosition } from './movement.ts';
import type { MeleeWeaponId } from './weapon.ts';

export type PistolItem = {
    readonly itemId: string;
    readonly kind: 'pistol';
    readonly rounds: number;
    readonly magazineCapacity: number;
};
export type Item =
    { readonly itemId: string; readonly kind: 'bandage' | MeleeWeaponId } | PistolItem;
export type GroundItem = Item & { readonly position: WorldPosition };

/** Copy item state without retaining a ground position or inventory cell. */
export const copyItem = (item: Item): Item => {
    const base = { itemId: item.itemId, kind: item.kind };
    if (item.kind === 'pistol')
        return {
            itemId: item.itemId,
            kind: 'pistol',
            rounds: item.rounds,
            magazineCapacity: item.magazineCapacity,
        };
    return { ...base, kind: item.kind };
};
