import { initialGroundItem } from '@zombi-survive/content';
import { type InventoryItem, isMeleeWeaponId, type ItemLocation } from '@zombi-survive/domain';
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

export const copyItemLocation = (location: ItemLocation): ItemLocation => {
    if (location.type === 'ground') {
        return {
            type: 'ground',
            item: { ...location.item, position: { ...location.item.position } },
        };
    }

    if (location.type === 'hands') {
        return { type: 'hands', playerId: location.playerId, item: { ...location.item } };
    }

    return { ...location, item: { ...location.item }, cell: { ...location.cell } };
};

/** v4 saves each known instance exactly once and validates the whole grid together. */
export const readSavedItems = (value: unknown, playerId: string): readonly ItemLocation[] => {
    if (typeof value !== 'string' || value.length > 16_384) return invalidItem();

    const saved: unknown = JSON.parse(value);

    if (!Array.isArray(saved) || saved.length !== 5) return invalidItem();

    const locations: ItemLocation[] = [];
    const ids = new Set<string>();
    let items: readonly InventoryItem[] = [];
    let hasHands = false;

    for (const entry of saved as unknown[]) {
        if (!isRecord(entry) || !isRecord(entry['item'])) return invalidItem();

        const item = entry['item'];
        const kind = item['kind'];
        const itemId = item['itemId'];

        if (kind === 'bandage') {
            locations.push(readSavedItem(JSON.stringify(entry), playerId));
        } else {
            const isOwner = entry['playerId'] === playerId;
            const isUnplaced = item['position'] === undefined;

            if (
                !isMeleeWeaponId(kind) ||
                itemId !== `${playerId}:${kind}` ||
                !isOwner ||
                !isUnplaced
            )
                return invalidItem();

            const weapon = { itemId, kind };

            if (entry['type'] === 'hands') {
                if (hasHands || entry['cell'] !== undefined) return invalidItem();

                hasHands = true;
                locations.push({ type: 'hands', playerId, item: weapon });
            } else {
                const cell = entry['cell'];

                if (entry['type'] !== 'container' || !isRecord(cell)) return invalidItem();

                const column = cell['column'];
                const row = cell['row'];

                if (typeof column !== 'number' || typeof row !== 'number') return invalidItem();

                locations.push({
                    type: 'container',
                    playerId,
                    item: weapon,
                    cell: { column, row },
                });
            }
        }

        const location = locations.at(-1);

        if (location === undefined || ids.has(location.item.itemId)) return invalidItem();

        ids.add(location.item.itemId);

        if (location.type === 'container') {
            const placed = placeInventoryItem({ items, item: location.item, cell: location.cell });

            if (placed === null) return invalidItem();

            items = placed;
        }
    }

    return locations;
};

export const writeSavedItems = (locations: readonly ItemLocation[], playerId: string): string =>
    JSON.stringify(readSavedItems(JSON.stringify(locations), playerId));
