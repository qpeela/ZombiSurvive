import type { ZombieState } from '@zombi-survive/domain';

import { protocolVersion } from './movement.ts';

export const zombieVersion = 1;
export const zombieSnapshotLimit = 256;
export type ZombieSnapshot = {
    readonly type: 'zombie-state';
    readonly protocolVersion: typeof protocolVersion;
    readonly zombieVersion: typeof zombieVersion;
    readonly worldId: string;
    readonly tick: number;
    readonly zombies: readonly ZombieState[];
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false;
    }

    return value.length > 0 && value.length <= 128 && value.trim() === value;
};
const isCoordinate = (value: unknown): boolean =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 64_000_000;
const isZombie = (value: unknown): value is ZombieState => {
    if (!isRecord(value)) {
        return false;
    }

    const position = value['position'];
    const isTarget = value['targetPlayerId'] === null || isId(value['targetPlayerId']);

    if (!isId(value['zombieId']) || !isTarget || !isRecord(position)) {
        return false;
    }

    return isCoordinate(position['xMeters']) && isCoordinate(position['yMeters']);
};

export const isZombieSnapshot = (value: unknown): value is ZombieSnapshot => {
    if (!isRecord(value)) {
        return false;
    }

    const isType = value['type'] === 'zombie-state';
    const isVersion =
        value['protocolVersion'] === protocolVersion && value['zombieVersion'] === zombieVersion;
    const tick = value['tick'];
    const isTick = typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0;
    const zombies: unknown = value['zombies'];

    if (!isType || !isVersion || !isTick || !isId(value['worldId']) || !Array.isArray(zombies)) {
        return false;
    }

    return (
        zombies.length <= zombieSnapshotLimit &&
        zombies.every(isZombie) &&
        new Set(zombies.map(zombie => zombie.zombieId)).size === zombies.length
    );
};
