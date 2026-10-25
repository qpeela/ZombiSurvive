import { inventorySettings, itemDefinitions } from '@zombi-survive/content';
import type { InventoryCell, InventoryItem, InventorySettings, Item } from '@zombi-survive/domain';

export const inventoryWeightGrams = (items: readonly Item[]): number =>
    items.reduce((weight, item) => weight + itemDefinitions[item.kind].weightGrams, 0);

/** Replaces the same item atomically; null leaves the original inventory unchanged. */
export const placeInventoryItem = ({
    items,
    item,
    cell,
    settings = inventorySettings,
}: {
    readonly items: readonly InventoryItem[];
    readonly item: Item;
    readonly cell: InventoryCell;
    readonly settings?: InventorySettings;
}): readonly InventoryItem[] | null => {
    const size = itemDefinitions[item.kind];
    const isIntegerCell = Number.isSafeInteger(cell.column) && Number.isSafeInteger(cell.row);
    const isInBounds =
        cell.column >= 0 &&
        cell.row >= 0 &&
        cell.column + size.columns <= settings.columns &&
        cell.row + size.rows <= settings.rows;

    if (!isIntegerCell || !isInBounds) {
        return null;
    }

    const others = items.filter(existing => existing.itemId !== item.itemId);
    const isOverlapping = others.some(existing => {
        const existingSize = itemDefinitions[existing.kind];
        const isColumnOverlap =
            cell.column < existing.cell.column + existingSize.columns &&
            cell.column + size.columns > existing.cell.column;
        const isRowOverlap =
            cell.row < existing.cell.row + existingSize.rows &&
            cell.row + size.rows > existing.cell.row;

        return isColumnOverlap && isRowOverlap;
    });
    const isOverweight = inventoryWeightGrams([...others, item]) > settings.maxWeightGrams;

    if (isOverlapping || isOverweight) {
        return null;
    }

    return [...others, { itemId: item.itemId, kind: item.kind, cell: { ...cell } }];
};

export const findInventorySpace = ({
    items,
    item,
}: {
    readonly items: readonly InventoryItem[];
    readonly item: Item;
}): InventoryCell | null => {
    for (let row = 0; row < inventorySettings.rows; row++) {
        for (let column = 0; column < inventorySettings.columns; column++) {
            const cell = { column, row };

            if (placeInventoryItem({ items, item, cell }) !== null) {
                return cell;
            }
        }
    }

    return null;
};
