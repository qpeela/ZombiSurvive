import type { GroundItem, Item } from '@zombi-survive/domain';

import { protocolVersion } from './movement.ts';

export const pickupStateRequest = 'pickup-state-request';
export type PickupCommand = {
    readonly type: 'pickup-item';
    readonly protocolVersion: typeof protocolVersion;
    readonly itemId: string;
};
export type PickupSnapshot = {
    readonly type: 'pickup-state';
    readonly protocolVersion: typeof protocolVersion;
    readonly worldId: string;
    readonly playerId: string;
    readonly tick: number;
    readonly groundItem: GroundItem | null;
    readonly items: readonly Item[];
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

    return isId(value['itemId']) && value['kind'] === 'bandage';
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
    const isVersion = value['protocolVersion'] === protocolVersion;
    const isWorld = isId(value['worldId']);
    const isPlayer = isId(value['playerId']);
    const tick = value['tick'];
    const isTick = typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0;
    const items: unknown = value['items'];
    const ground: unknown = value['groundItem'];

    if (!isType || !isVersion || !isWorld || !isPlayer || !isTick || !Array.isArray(items)) {
        return false;
    }

    if (items.length > 1 || !items.every(isItem)) {
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

    if (!isRecord(position) || items.length !== 0) {
        return false;
    }

    const isCoordinate = (coordinate: unknown): boolean =>
        typeof coordinate === 'number' && Number.isFinite(coordinate);

    return isCoordinate(position['xMeters']) && isCoordinate(position['yMeters']);
};
