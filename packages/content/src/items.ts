import type { GroundItem, Item } from '@zombi-survive/domain';

export const pickupSettings = Object.freeze({ rangeMeters: 1.5 });
export const initialGroundItem: GroundItem = Object.freeze({
    itemId: 'starter-bandage',
    kind: 'bandage',
    position: Object.freeze({ xMeters: 2, yMeters: 2 }),
});

export const inventorySettings = Object.freeze({ columns: 4, rows: 3, maxWeightGrams: 2000 });
export const ammoSettings = Object.freeze({ stackQuantity: 8, roundWeightGrams: 12 });

export const itemDefinitions = Object.freeze({
    ammo9mm: Object.freeze({ name: 'Патроны 9 мм', columns: 1, rows: 1, weightGrams: 12 }),
    pistol: Object.freeze({ name: 'Пистолет 9 мм', columns: 2, rows: 1, weightGrams: 800 }),
    bandage: Object.freeze({ name: 'Бинт', columns: 2, rows: 1, weightGrams: 100 }),
    club: Object.freeze({ name: 'Дубинка', columns: 1, rows: 1, weightGrams: 400 }),
    knife: Object.freeze({ name: 'Нож', columns: 1, rows: 1, weightGrams: 100 }),
    crowbar: Object.freeze({ name: 'Лом', columns: 1, rows: 1, weightGrams: 600 }),
    axe: Object.freeze({ name: 'Топор', columns: 1, rows: 1, weightGrams: 800 }),
});

export const itemWeightGrams = (item: Item): number =>
    item.kind === 'ammo9mm'
        ? ammoSettings.roundWeightGrams * item.quantity
        : itemDefinitions[item.kind].weightGrams;
export const itemDisplayName = (item: Item): string =>
    item.kind === 'ammo9mm'
        ? `${itemDefinitions[item.kind].name} ×${String(item.quantity)}`
        : itemDefinitions[item.kind].name;
