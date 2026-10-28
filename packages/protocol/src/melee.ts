import { isMeleeWeaponId, type MeleeWeaponId } from '@zombi-survive/domain';

import { protocolVersion } from './movement.ts';

export const meleeVersion = 2;
export type MeleeIntent =
    | { readonly type: 'equip-weapon'; readonly weapon: MeleeWeaponId }
    | { readonly type: 'melee-attack' };
export type MeleeCommand = MeleeIntent & {
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
    readonly weapon: MeleeWeaponId | null;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isVersion = (value: Record<string, unknown>): boolean =>
    value['protocolVersion'] === protocolVersion && value['meleeVersion'] === meleeVersion;
const isId = (value: unknown): boolean =>
    typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;

export const isMeleeCommand = (value: unknown): value is MeleeCommand => {
    if (!isRecord(value)) return false;

    const isType =
        value['type'] === 'melee-attack' ||
        (value['type'] === 'equip-weapon' && isMeleeWeaponId(value['weapon']));

    return isType && isVersion(value);
};
export const isMeleeSnapshot = (value: unknown): value is MeleeSnapshot => {
    if (!isRecord(value)) return false;

    const tick = value['tick'];
    const isTick = typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0;
    const isWeapon = value['weapon'] === null || isMeleeWeaponId(value['weapon']);

    return (
        value['type'] === 'melee-state' &&
        isVersion(value) &&
        isTick &&
        isWeapon &&
        isId(value['worldId']) &&
        isId(value['playerId'])
    );
};

/** Emitted only on the server step that accepts an attack, including misses. */
export type MeleeAction = {
    readonly type: 'melee-action';
    readonly protocolVersion: typeof protocolVersion;
    readonly meleeVersion: typeof meleeVersion;
    readonly worldId: string;
    readonly playerId: string;
    readonly tick: number;
    readonly weapon: MeleeWeaponId;
};
export const isMeleeAction = (value: unknown): value is MeleeAction => {
    if (!isRecord(value)) {
        return false;
    }

    const tick = value['tick'];
    const isTick = typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0;

    return (
        value['type'] === 'melee-action' &&
        isVersion(value) &&
        isTick &&
        isMeleeWeaponId(value['weapon']) &&
        isId(value['worldId']) &&
        isId(value['playerId'])
    );
};
