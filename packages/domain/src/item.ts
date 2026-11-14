import type { WorldPosition } from './movement.ts';
import type { MeleeWeaponId } from './weapon.ts';

export type PistolItem = {
    readonly itemId: string;
    readonly kind: 'pistol';
    readonly rounds: number;
    readonly magazineCapacity: number;
    /** Persisted compare-and-set token; old instances begin at zero. */
    readonly revision?: number;
};
export type AmmoStack = {
    readonly itemId: string;
    readonly kind: 'ammo9mm';
    readonly quantity: number;
};

export type Item =
    { readonly itemId: string; readonly kind: 'bandage' | MeleeWeaponId } | PistolItem | AmmoStack;
export type GroundItem = Item & { readonly position: WorldPosition };

/** Copy item state without retaining a ground position or inventory cell. */
export const copyItem = (item: Item): Item => {
    const base = { itemId: item.itemId, kind: item.kind };

    if (item.kind === 'ammo9mm')
        return { itemId: item.itemId, kind: item.kind, quantity: item.quantity };
    if (item.kind === 'pistol')
        return {
            itemId: item.itemId,
            kind: 'pistol',
            ...(item.revision === undefined ? {} : { revision: item.revision }),
            rounds: item.rounds,
            magazineCapacity: item.magazineCapacity,
        };
    return { ...base, kind: item.kind };
};
