import { protocolVersion } from './movement.ts';

export const meleeVersion = 1;
export type MeleeCommand = {
    readonly type: 'equip-club' | 'melee-attack';
    readonly protocolVersion: typeof protocolVersion;
    readonly meleeVersion: typeof meleeVersion;
};
export type MeleeSnapshot = {
    readonly type: 'melee-state';
    readonly protocolVersion: typeof protocolVersion;
    readonly meleeVersion: typeof meleeVersion;
    readonly worldId: string;
    readonly playerId: string;
    readonly tick: number;
    readonly weapon: 'club' | null;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isVersion = (value: Record<string, unknown>): boolean =>
    value['protocolVersion'] === protocolVersion && value['meleeVersion'] === meleeVersion;
const isId = (value: unknown): boolean =>
    typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;

export const isMeleeCommand = (value: unknown): value is MeleeCommand => {
    if (!isRecord(value)) return false;

    const isType = value['type'] === 'equip-club' || value['type'] === 'melee-attack';

    return isType && isVersion(value);
};
export const isMeleeSnapshot = (value: unknown): value is MeleeSnapshot => {
    if (!isRecord(value)) return false;

    const tick = value['tick'];
    const isTick = typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0;
    const isWeapon = value['weapon'] === null || value['weapon'] === 'club';

    return (
        value['type'] === 'melee-state' &&
        isVersion(value) &&
        isTick &&
        isWeapon &&
        isId(value['worldId']) &&
        isId(value['playerId'])
    );
};
