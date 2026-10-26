import type { PlayerHealth } from '@zombi-survive/domain';

import { protocolVersion } from './movement.ts';

export const healthVersion = 1;
export type HealthSnapshot = PlayerHealth & {
    readonly type: 'health-state';
    readonly protocolVersion: typeof protocolVersion;
    readonly healthVersion: typeof healthVersion;
    readonly worldId: string;
    readonly tick: number;
    readonly maxHealth: number;
};
const isId = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false;
    }

    return value.length > 0 && value.length <= 128 && value.trim() === value;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const isHealthSnapshot = (value: unknown): value is HealthSnapshot => {
    if (!isRecord(value)) {
        return false;
    }

    const record = value;
    const isType = record['type'] === 'health-state';
    const isVersion =
        record['protocolVersion'] === protocolVersion && record['healthVersion'] === healthVersion;
    const tick = record['tick'];
    const health = record['health'];
    const maxHealth = record['maxHealth'];
    const isTick = typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0;
    const isHealth = typeof health === 'number' && Number.isSafeInteger(health) && health >= 0;
    const isMaxHealth =
        typeof maxHealth === 'number' && Number.isSafeInteger(maxHealth) && maxHealth > 0;

    if (!isHealth || !isMaxHealth) {
        return false;
    }

    return (
        isType &&
        isVersion &&
        isTick &&
        isId(record['worldId']) &&
        isId(record['playerId']) &&
        health <= maxHealth
    );
};
