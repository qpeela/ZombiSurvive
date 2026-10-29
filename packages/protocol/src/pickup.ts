import {
    type GroundItem,
    type InventoryCell,
    type InventoryItem,
    isMeleeWeaponId,
    type Item,
} from '@zombi-survive/domain';

import { protocolVersion } from './movement.ts';

export const inventoryVersion = 2;
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
export type PickupSnapshot = {
    readonly type: 'pickup-state';
    readonly inventoryVersion: typeof inventoryVersion;
    readonly protocolVersion: typeof protocolVersion;
    readonly worldId: string;
    readonly playerId: string;
    readonly tick: number;
    readonly groundItem: GroundItem | null;
    readonly items: readonly InventoryItem[];
    readonly hands: Item | null;
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

    return isId(value['itemId']) && (value['kind'] === 'bandage' || isMeleeWeaponId(value['kind']));
};
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

    const hands: unknown = value['hands'];

    if (hands !== null && (!isItem(hands) || !isMeleeWeaponId(hands.kind))) {
        return false;
    }

    const ids = items.map((item: InventoryItem) => item.itemId);

    if (hands !== null) ids.push(hands.itemId);

    if (ground !== null && isItem(ground)) ids.push(ground.itemId);

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
