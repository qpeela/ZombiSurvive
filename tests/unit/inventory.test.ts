import { inventorySettings } from '@zombi-survive/content';
import type { InventoryItem, Item } from '@zombi-survive/domain';
import {
    findInventorySpace,
    inventoryWeightGrams,
    placeInventoryItem,
} from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const item: Item = { itemId: 'bandage', kind: 'bandage' };
const placed: InventoryItem = { ...item, cell: { column: 0, row: 0 } };

test('placement uses the full footprint and allows exact edges without mutating inputs', () => {
    const items = [placed];
    const cell = { column: 2, row: 2 };
    const result = placeInventoryItem({ items, item, cell });
    expect(result).toEqual([{ ...item, cell }]);
    expect(items).toEqual([placed]);
    expect(items[0]?.cell).toEqual({ column: 0, row: 0 });
    expect(result?.[0]?.cell).not.toBe(cell);
    expect(inventoryWeightGrams(result ?? [])).toBe(100);
    // A move may overlap the original footprint of that same item.
    expect(placeInventoryItem({ items, item, cell: { column: 1, row: 0 } })).toHaveLength(1);
});

test.each([
    { column: -1, row: 0 },
    { column: 3, row: 0 },
    { column: 0, row: -1 },
    { column: 0, row: 3 },
    { column: 0.5, row: 0 },
    { column: 0, row: NaN },
    { column: Infinity, row: 0 },
])('invalid cell %j leaves inventory untouched', cell => {
    const items = [placed];
    expect(placeInventoryItem({ items, item, cell })).toBeNull();
    expect(items).toEqual([placed]);
});

test('other footprints block placement, adjacent cells remain usable', () => {
    const other = { ...placed, itemId: 'other' };
    const items = [other];
    expect(placeInventoryItem({ items, item, cell: { column: 1, row: 0 } })).toBeNull();
    expect(placeInventoryItem({ items, item, cell: { column: 2, row: 0 } })).toEqual([
        other,
        { ...item, cell: { column: 2, row: 0 } },
    ]);
    expect(findInventorySpace({ items, item })).toEqual({ column: 2, row: 0 });
    expect(items).toEqual([other]);
});

test('automatic placement rejects a full or fragmented grid without losing items', () => {
    const full = Array.from({ length: 6 }, (_, index) => ({
        ...item,
        itemId: `existing-${String(index)}`,
        cell: { column: (index % 2) * 2, row: Math.floor(index / 2) },
    }));
    expect(findInventorySpace({ items: full, item })).toBeNull();
    const fragmented = [0, 1, 2].map(row => ({
        ...item,
        itemId: `existing-${String(row)}`,
        cell: { column: 1, row },
    }));
    expect(findInventorySpace({ items: fragmented, item })).toBeNull();
    expect(findInventorySpace({ items: [], item })).toEqual({ column: 0, row: 0 });
});

test('mass limit counts the moved item once and rejects additions above the limit', () => {
    const settings = { ...inventorySettings, maxWeightGrams: 100 };
    const items = [placed];
    const cell = { column: 2, row: 0 };
    expect(placeInventoryItem({ items, item, cell, settings })).toHaveLength(1);
    expect(
        placeInventoryItem({ items, item: { ...item, itemId: 'extra' }, cell, settings }),
    ).toBeNull();
    expect(
        placeInventoryItem({
            items: [],
            item,
            cell,
            settings: { ...settings, maxWeightGrams: 99 },
        }),
    ).toBeNull();
    expect(inventoryWeightGrams([])).toBe(0);
});
