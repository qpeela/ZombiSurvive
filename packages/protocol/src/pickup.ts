import {
    type Corpse,
    type GroundItem,
    type InventoryCell,
    type InventoryItem,
    isWeaponId,
    type Item,
    type WorldPosition,
} from '@zombi-survive/domain';

import { protocolVersion } from './movement.ts';

export const inventoryVersion = 2;
export type UseBandageCommand = {
    readonly type: 'use-bandage';
    readonly protocolVersion: typeof protocolVersion;
    readonly inventoryVersion: typeof inventoryVersion;
    readonly itemId: string;
};
export type DrinkWaterCommand = Omit<UseBandageCommand, 'type'> & {
    readonly type: 'drink-water';
};
export type EatRationCommand = Omit<UseBandageCommand, 'type'> & {
    readonly type: 'eat-ration';
};
export type InventoryMoveCommand = {
    readonly type: 'inventory-move';
    readonly protocolVersion: typeof protocolVersion;
    readonly inventoryVersion: typeof inventoryVersion;
    readonly itemId: string;
    readonly cell: InventoryCell;
};

export const pickupStateRequest = 'pickup-state-request';
export type PickupCommand = {
    readonly type: 'pickup-item';
    readonly protocolVersion: typeof protocolVersion;
    readonly itemId: string;
};
export type LootRestock = {
    readonly pointId: string;
    readonly kind: Item['kind'];
    readonly position: WorldPosition;
    readonly readyAtWorldMs: number;
};

export type StorageLoot = {
    readonly storageId: string;
    readonly position: WorldPosition;
    readonly items: readonly Item[];
};

export type PickupSnapshot = {
    readonly type: 'pickup-state';
    readonly restocks?: readonly LootRestock[];
    readonly inventoryVersion: typeof inventoryVersion;
    readonly protocolVersion: typeof protocolVersion;
    readonly worldId: string;
    readonly playerId: string;
    readonly tick: number;
    readonly groundItem: GroundItem | null;
    readonly items: readonly InventoryItem[];
    readonly hands: Item | null;
    readonly storage?: StorageLoot;
    readonly corpses?: readonly (Corpse & { readonly items: readonly Item[] })[];
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false;
    }

    return value.length > 0 && value.length <= 128 && value.trim() === value;
};
const isItem = (value: unknown): value is Item => {
    if (!isRecord(value)) {
        return false;
    }

    if (!isId(value['itemId'])) return false;
    if (value['kind'] === 'waterBottle') {
        return value['servings'] === 0 || value['servings'] === 1;
    }
    if (value['kind'] === 'ammo9mm') {
        const quantity = value['quantity'];
        return (
            typeof quantity === 'number' &&
            Number.isSafeInteger(quantity) &&
            quantity > 0 &&
            quantity <= 1024
        );
    }

    if (value['kind'] === 'pistol') {
        const rounds = value['rounds'];
        const capacity = value['magazineCapacity'];
        const revision = value['revision'];
        const isRevision =
            revision === undefined ||
            (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0);
        const isCapacity =
            typeof capacity === 'number' &&
            Number.isSafeInteger(capacity) &&
            capacity > 0 &&
            capacity <= 128;
        const isRounds = typeof rounds === 'number' && Number.isSafeInteger(rounds) && rounds >= 0;
        return isRevision && isCapacity && isRounds && rounds <= capacity;
    }
    return value['kind'] === 'bandage' || value['kind'] === 'ration' || isWeaponId(value['kind']);
};

export const isUseBandageCommand = (value: unknown): value is UseBandageCommand => {
    if (!isRecord(value)) return false;

    const isType = value['type'] === 'use-bandage';
    const isVersion =
        value['protocolVersion'] === protocolVersion &&
        value['inventoryVersion'] === inventoryVersion;

    return isType && isVersion && isId(value['itemId']);
};
export const isDrinkWaterCommand = (value: unknown): value is DrinkWaterCommand =>
    isRecord(value) &&
    value['type'] === 'drink-water' &&
    value['protocolVersion'] === protocolVersion &&
    value['inventoryVersion'] === inventoryVersion &&
    isId(value['itemId']);

export const isEatRationCommand = (value: unknown): value is EatRationCommand =>
    isRecord(value) &&
    value['type'] === 'eat-ration' &&
    value['protocolVersion'] === protocolVersion &&
    value['inventoryVersion'] === inventoryVersion &&
    isId(value['itemId']);

const isCell = (value: unknown): value is InventoryCell => {
    if (!isRecord(value)) {
        return false;
    }

    const isIndex = (index: unknown): boolean =>
        typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < 32;

    return isIndex(value['column']) && isIndex(value['row']);
};

export const isInventoryMoveCommand = (value: unknown): value is InventoryMoveCommand => {
    if (!isRecord(value)) {
        return false;
    }

    const isType = value['type'] === 'inventory-move';
    const isVersion =
        value['protocolVersion'] === protocolVersion &&
        value['inventoryVersion'] === inventoryVersion;

    return isType && isVersion && isId(value['itemId']) && isCell(value['cell']);
};

export const isPickupCommand = (value: unknown): value is PickupCommand => {
    if (!isRecord(value)) {
        return false;
    }

    const isType = value['type'] === 'pickup-item';
    const isVersion = value['protocolVersion'] === protocolVersion;

    return isType && isVersion && isId(value['itemId']);
};
const isLootRestock = (value: unknown): value is LootRestock => {
    if (!isRecord(value) || !isId(value['pointId'])) return false;
    const kind = value['kind'];
    const isKnownKind = kind === 'bandage' || kind === 'ammo9mm' || isWeaponId(kind);
    const position = value['position'];
    if (!isRecord(position)) return false;
    const isValidPosition =
        typeof position['xMeters'] === 'number' &&
        Number.isFinite(position['xMeters']) &&
        typeof position['yMeters'] === 'number' &&
        Number.isFinite(position['yMeters']);
    const deadline = value['readyAtWorldMs'];
    const isValidDeadline =
        typeof deadline === 'number' && Number.isSafeInteger(deadline) && deadline >= 0;
    return isKnownKind && isValidPosition && isValidDeadline;
};

export const isPickupSnapshot = (value: unknown): value is PickupSnapshot => {
    if (!isRecord(value)) {
        return false;
    }

    const isType = value['type'] === 'pickup-state';
    const isVersion =
        value['protocolVersion'] === protocolVersion &&
        value['inventoryVersion'] === inventoryVersion;
    const isWorld = isId(value['worldId']);
    const isPlayer = isId(value['playerId']);
    const tick = value['tick'];
    const isTick = typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0;
    const items: unknown = value['items'];
    const ground: unknown = value['groundItem'];

    if (!isType || !isVersion || !isWorld || !isPlayer || !isTick || !Array.isArray(items)) {
        return false;
    }

    if (
        items.length > 128 ||
        !items.every((item: unknown) => isRecord(item) && isCell(item['cell']) && isItem(item))
    ) {
        return false;
    }

    const restocks: unknown = value['restocks'];
    if (restocks !== undefined) {
        if (!Array.isArray(restocks) || restocks.length > 128 || !restocks.every(isLootRestock))
            return false;
        if (new Set(restocks.map((point: LootRestock) => point.pointId)).size !== restocks.length)
            return false;
    }

    const hands: unknown = value['hands'];

    if (hands !== null && (!isItem(hands) || !isWeaponId(hands.kind))) {
        return false;
    }

    const ids = items.map((item: InventoryItem) => item.itemId);

    if (hands !== null) ids.push(hands.itemId);

    if (ground !== null && isItem(ground)) ids.push(ground.itemId);

    const corpses: unknown = value['corpses'];
    if (corpses !== undefined) {
        if (!Array.isArray(corpses) || corpses.length > 128) return false;
        const corpseIds = new Set<string>();
        for (const corpse of corpses as unknown[]) {
            if (!isRecord(corpse) || !isId(corpse['corpseId']) || !isId(corpse['playerId']))
                return false;
            const position = corpse['position'];
            const diedAtMs = corpse['diedAtMs'];
            const loot = corpse['items'];
            const expiresAtMs = corpse['expiresAtMs'];
            if (typeof expiresAtMs !== 'number' || !Number.isSafeInteger(expiresAtMs)) return false;
            if (
                !isRecord(position) ||
                !Number.isFinite(position['xMeters']) ||
                !Number.isFinite(position['yMeters'])
            )
                return false;
            if (typeof diedAtMs !== 'number' || !Number.isSafeInteger(diedAtMs) || diedAtMs < 0)
                return false;
            if (expiresAtMs < diedAtMs) return false;
            if (!Array.isArray(loot) || loot.length > 128 || !loot.every(isItem)) return false;
            if (corpseIds.has(corpse['corpseId'])) return false;
            corpseIds.add(corpse['corpseId']);
            ids.push(...loot.map((item: Item) => item.itemId));
        }
    }

    const storage = value['storage'];
    if (storage !== undefined) {
        if (!isRecord(storage) || !isId(storage['storageId'])) return false;
        const position = storage['position'];
        const loot: unknown = storage['items'];
        if (
            !isRecord(position) ||
            !Number.isFinite(position['xMeters']) ||
            !Number.isFinite(position['yMeters'])
        )
            return false;
        if (!Array.isArray(loot) || loot.length > 128 || !loot.every(isItem)) return false;
        ids.push(...loot.map((item: Item) => item.itemId));
    }

    if (new Set(ids).size !== ids.length) {
        return false;
    }

    if (ground === null) {
        return true;
    }

    if (!isRecord(ground)) {
        return false;
    }

    const position = ground['position'];

    if (!isItem(ground)) {
        return false;
    }

    if (!isRecord(position)) {
        return false;
    }

    const isCoordinate = (coordinate: unknown): boolean =>
        typeof coordinate === 'number' && Number.isFinite(coordinate);

    return isCoordinate(position['xMeters']) && isCoordinate(position['yMeters']);
};
