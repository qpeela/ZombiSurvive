import { initialGroundItem } from '@zombi-survive/content';
import type { ItemLocation } from '@zombi-survive/domain';
import { placeInventoryItem } from '@zombi-survive/simulation';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const invalidItem = (): never => {
    throw new Error('Solo save contains an invalid item location.');
};

/** Schema v3 has exactly the existing starter item; no loot is regenerated on load. */
export const readSavedItem = (value: unknown, playerId: string): ItemLocation => {
    if (typeof value !== 'string' || value.length > 2048) {
        return invalidItem();
    }

    const saved: unknown = JSON.parse(value);

    if (!isRecord(saved) || !isRecord(saved['item'])) {
        return invalidItem();
    }

    const item = saved['item'];
    const isKnownItem =
        item['itemId'] === initialGroundItem.itemId && item['kind'] === initialGroundItem.kind;

    if (!isKnownItem) {
        return invalidItem();
    }

    if (saved['type'] === 'ground') {
        const position = item['position'];
        const hasNoOwner = saved['playerId'] === undefined && saved['cell'] === undefined;

        if (!hasNoOwner || !isRecord(position)) {
            return invalidItem();
        }

        const isSpawn =
            position['xMeters'] === initialGroundItem.position.xMeters &&
            position['yMeters'] === initialGroundItem.position.yMeters;

        if (!isSpawn) {
            return invalidItem();
        }

        return {
            type: 'ground',
            item: { ...initialGroundItem, position: { ...initialGroundItem.position } },
        };
    }

    const cell = saved['cell'];
    const isOwner = saved['type'] === 'container' && saved['playerId'] === playerId;

    if (!isOwner || !isRecord(cell) || item['position'] !== undefined) {
        return invalidItem();
    }

    const column = cell['column'];
    const row = cell['row'];

    if (typeof column !== 'number' || typeof row !== 'number') {
        return invalidItem();
    }

    const placed = placeInventoryItem({
        items: [],
        item: initialGroundItem,
        cell: { column, row },
    });

    if (placed === null) {
        return invalidItem();
    }

    return {
        type: 'container',
        playerId,
        item: { itemId: initialGroundItem.itemId, kind: initialGroundItem.kind },
        cell: { column, row },
    };
};

export const writeSavedItem = (location: ItemLocation, playerId: string): string =>
    JSON.stringify(readSavedItem(JSON.stringify(location), playerId));

export const copyItemLocation = (location: ItemLocation): ItemLocation =>
    location.type === 'ground'
        ? { type: 'ground', item: { ...location.item, position: { ...location.item.position } } }
        : {
              type: 'container',
              playerId: location.playerId,
              item: { ...location.item },
              cell: { ...location.cell },
          };
