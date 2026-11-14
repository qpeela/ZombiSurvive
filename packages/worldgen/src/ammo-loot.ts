import { ammoSettings, worldGenerationSettings } from '@zombi-survive/content';
import type { GroundItem } from '@zombi-survive/domain';

import { generateWorldPistolLoot } from './pistol-loot.ts';

/** A finite ammo pack shares the already accessible pistol loot site. */
export const generateWorldAmmoLoot = (seed: string): readonly GroundItem[] => {
    const pistol = generateWorldPistolLoot(seed)[0];

    if (pistol === undefined) throw new Error('Ammo overlay needs a pistol loot site.');

    return Object.freeze([
        Object.freeze({
            itemId: 'ammo9mm-v1:0:0',
            kind: 'ammo9mm' as const,
            quantity: ammoSettings.stackQuantity,
            position: Object.freeze({ ...pistol.position }),
        }),
    ]);
};
export const initialWorldAmmoLoot = generateWorldAmmoLoot(worldGenerationSettings.initialSeed);
