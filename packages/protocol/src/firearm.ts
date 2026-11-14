import type { WorldPosition } from '@zombi-survive/domain';

import { isMeleeImpact, type MeleeImpact } from './melee.ts';
import { protocolVersion } from './movement.ts';

export const firearmVersion = 1;
export type ShotAim = { readonly x: number; readonly y: number };
export type ShootCommand = {
    readonly type: 'shoot-pistol';
    readonly protocolVersion: typeof protocolVersion;
    readonly firearmVersion: typeof firearmVersion;
    readonly itemId: string;
    readonly weaponRevision: number;
    readonly aim: ShotAim;
};
export type ShotAction = {
    readonly type: 'shot-action';
    readonly protocolVersion: typeof protocolVersion;
    readonly firearmVersion: typeof firearmVersion;
    readonly worldId: string;
    readonly playerId: string;
    readonly tick: number;
    readonly itemId: string;
    readonly weaponRevision: number;
    readonly origin: WorldPosition;
    readonly impact: MeleeImpact;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): boolean =>
    typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;
const isRevision = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isVersion = (value: Record<string, unknown>): boolean =>
    value['protocolVersion'] === protocolVersion && value['firearmVersion'] === firearmVersion;
export const isShotAim = (value: unknown): value is ShotAim => {
    if (!isRecord(value)) return false;
    const x = value['x'];
    const y = value['y'];
    const isComponent = (component: unknown): component is number =>
        typeof component === 'number' && Number.isFinite(component) && Math.abs(component) <= 1e6;
    if (!isComponent(x) || !isComponent(y)) return false;
    return Math.hypot(x, y) > 1e-6;
};
export const isShootCommand = (value: unknown): value is ShootCommand =>
    isRecord(value) &&
    value['type'] === 'shoot-pistol' &&
    isVersion(value) &&
    isId(value['itemId']) &&
    isRevision(value['weaponRevision']) &&
    isShotAim(value['aim']);
export const isShotAction = (value: unknown): value is ShotAction => {
    if (!isRecord(value) || !isRecord(value['origin'])) return false;
    const origin = value['origin'];
    const isCoordinate = (coordinate: unknown): boolean =>
        typeof coordinate === 'number' &&
        Number.isFinite(coordinate) &&
        Math.abs(coordinate) <= 64e6;
    return (
        value['type'] === 'shot-action' &&
        isVersion(value) &&
        isId(value['worldId']) &&
        isId(value['playerId']) &&
        isId(value['itemId']) &&
        isRevision(value['tick']) &&
        isRevision(value['weaponRevision']) &&
        isCoordinate(origin['xMeters']) &&
        isCoordinate(origin['yMeters']) &&
        isMeleeImpact(value['impact'])
    );
};
