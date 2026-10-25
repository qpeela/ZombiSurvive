import type { GroundItem } from '@zombi-survive/domain';

export const pickupSettings = Object.freeze({ rangeMeters: 1.5 });
export const initialGroundItem: GroundItem = Object.freeze({
    itemId: 'starter-bandage',
    kind: 'bandage',
    position: Object.freeze({ xMeters: 2, yMeters: 2 }),
});

export const inventorySettings = Object.freeze({ columns: 4, rows: 3, maxWeightGrams: 2000 });
export const itemDefinitions = Object.freeze({
    bandage: Object.freeze({ columns: 2, rows: 1, weightGrams: 100 }),
});
