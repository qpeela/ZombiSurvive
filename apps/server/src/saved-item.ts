import { ammoSettings, initialGroundItem, pistolSettings } from '@zombi-survive/content';
import {
    copyItem,
    type GroundItem,
    type InventoryItem,
    isMeleeWeaponId,
    isWeaponId,
    type Item,
    type ItemLocation,
} from '@zombi-survive/domain';
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
        item: copyItem(initialGroundItem),
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

    if (location.type === 'consumed') return { ...location, item: { ...location.item } };
    if (location.type === 'expired') return { ...location, item: { ...location.item } };

    if (location.type === 'corpse') {
        return { ...location, item: { ...location.item } };
    }

    if (location.type === 'hands') {
        return { type: 'hands', playerId: location.playerId, item: { ...location.item } };
    }

    return { ...location, item: { ...location.item }, cell: { ...location.cell } };
};

const readKnownItem = (
    item: Record<string, unknown>,
    playerId: string,
    worldLoot: readonly GroundItem[],
): Item => {
    const kind = item['kind'];
    const itemId = item['itemId'];
    if (typeof itemId !== 'string') return invalidItem();
    if (kind === 'bandage' && itemId === initialGroundItem.itemId) return { itemId, kind };
    if (kind === 'ammo9mm') {
        const spawn = worldLoot.find(
            candidate => candidate.itemId === itemId && candidate.kind === kind,
        );
        const quantity = item['quantity'];
        const isQuantity =
            typeof quantity === 'number' &&
            Number.isSafeInteger(quantity) &&
            quantity >= 0 &&
            quantity <= ammoSettings.stackQuantity;
        if (spawn === undefined || !isQuantity) return invalidItem();
        return { itemId, kind, quantity };
    }
    if (!isWeaponId(kind)) return invalidItem();
    const spawn = worldLoot.find(candidate => candidate.itemId === itemId);
    const isStarter = isMeleeWeaponId(kind) && itemId === `${playerId}:${kind}`;
    const isWorld = spawn !== undefined && spawn.kind === kind;
    if (!isStarter && !isWorld) return invalidItem();
    if (kind === 'pistol') {
        const rounds = item['rounds'];
        const magazineCapacity = item['magazineCapacity'];
        const revision = item['revision'];
        const isRevision =
            revision === undefined ||
            (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0);
        if (!isRevision) return invalidItem();
        const isCapacity = magazineCapacity === pistolSettings.magazineCapacity;
        const isRounds =
            typeof rounds === 'number' &&
            Number.isSafeInteger(rounds) &&
            rounds >= 0 &&
            rounds <= pistolSettings.magazineCapacity;
        if (!isCapacity || !isRounds) return invalidItem();
        return {
            itemId,
            kind,
            rounds,
            magazineCapacity: pistolSettings.magazineCapacity,
            ...(revision === undefined ? {} : { revision }),
        };
    }
    return { itemId, kind };
};

/** Validates the complete finite manifest, instance state and inventory together. */
export const readSavedItems = (
    value: unknown,
    playerId: string,
    worldLoot: readonly GroundItem[] = [],
    isConsumableBandage = false,
): readonly ItemLocation[] => {
    if (typeof value !== 'string' || value.length > 16_384) return invalidItem();
    const saved: unknown = JSON.parse(value);
    if (!Array.isArray(saved)) return invalidItem();
    const finiteItemCount = 4 + worldLoot.length;
    const hasCompleteManifest = saved.length === finiteItemCount + 1;
    const hasConsumedBandage = isConsumableBandage && saved.length === finiteItemCount;
    if (!hasCompleteManifest && !hasConsumedBandage) return invalidItem();
    const locations: ItemLocation[] = [];
    const ids = new Set<string>();
    let items: readonly InventoryItem[] = [];
    let hasHands = false;
    for (const entry of saved as unknown[]) {
        if (!isRecord(entry) || !isRecord(entry['item'])) return invalidItem();
        const rawItem = entry['item'];
        const item = readKnownItem(rawItem, playerId, worldLoot);
        if (item.kind === 'ammo9mm') {
            const isConsumed = entry['type'] === 'consumed';
            if (isConsumed !== (item.quantity === 0)) return invalidItem();
        }
        if (ids.has(item.itemId)) return invalidItem();
        ids.add(item.itemId);
        let location: ItemLocation;
        if (entry['type'] === 'consumed') {
            if (
                item.kind !== 'ammo9mm' ||
                item.quantity !== 0 ||
                entry['playerId'] !== undefined ||
                entry['cell'] !== undefined ||
                entry['corpseId'] !== undefined ||
                rawItem['position'] !== undefined
            )
                return invalidItem();
            location = { type: 'consumed', item };
        } else if (entry['type'] === 'corpse' || entry['type'] === 'expired') {
            const corpseId = entry['corpseId'];
            const isUnowned =
                entry['playerId'] === undefined &&
                entry['cell'] === undefined &&
                rawItem['position'] === undefined;
            if (!isUnowned) return invalidItem();
            if (entry['type'] === 'corpse') {
                if (typeof corpseId !== 'string' || corpseId.length === 0 || corpseId.length > 128)
                    return invalidItem();
                location = { type: 'corpse', corpseId, item };
            } else {
                if (corpseId !== undefined) return invalidItem();
                location = { type: 'expired', item };
            }
        } else if (item.kind === 'bandage') {
            location = readSavedItem(JSON.stringify(entry), playerId);
        } else if (entry['type'] === 'ground') {
            const spawn = worldLoot.find(candidate => candidate.itemId === item.itemId);
            const position = rawItem['position'];
            const isUnowned = entry['playerId'] === undefined && entry['cell'] === undefined;
            if (spawn === undefined || !isUnowned || !isRecord(position)) return invalidItem();
            const isSpawn =
                position['xMeters'] === spawn.position.xMeters &&
                position['yMeters'] === spawn.position.yMeters;
            if (!isSpawn) return invalidItem();
            location = { type: 'ground', item: { ...item, position: { ...spawn.position } } };
        } else {
            const isOwner = entry['playerId'] === playerId;
            if (!isOwner || rawItem['position'] !== undefined) return invalidItem();
            if (entry['type'] === 'hands') {
                if (hasHands || entry['cell'] !== undefined || !isWeaponId(item.kind))
                    return invalidItem();
                hasHands = true;
                location = { type: 'hands', playerId, item };
            } else {
                const cell = entry['cell'];
                if (entry['type'] !== 'container' || !isRecord(cell)) return invalidItem();
                const column = cell['column'];
                const row = cell['row'];
                if (typeof column !== 'number' || typeof row !== 'number') return invalidItem();
                location = { type: 'container', playerId, item, cell: { column, row } };
            }
        }
        locations.push(location);
        if (location.type === 'container') {
            const placed = placeInventoryItem({ items, item: location.item, cell: location.cell });
            if (placed === null) return invalidItem();
            items = placed;
        }
    }
    if (locations.filter(location => location.item.kind !== 'bandage').length !== finiteItemCount)
        return invalidItem();
    return locations;
};

export const writeSavedItems = (
    locations: readonly ItemLocation[],
    playerId: string,
    worldLoot: readonly GroundItem[] = [],
): string => JSON.stringify(readSavedItems(JSON.stringify(locations), playerId, worldLoot, true));
