import type { GroundItem } from '@zombi-survive/domain';

export const pickupSettings = Object.freeze({ rangeMeters: 1.5 });
export const initialGroundItem: GroundItem = Object.freeze({
    itemId: 'starter-bandage',
    kind: 'bandage',
    position: Object.freeze({ xMeters: 2, yMeters: 2 }),
});
