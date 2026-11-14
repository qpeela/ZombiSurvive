import { pistolSettings } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition, ZombieState } from '@zombi-survive/domain';

import { movementStepSeconds } from './movement.ts';
import { moveZombieToward } from './zombie-movement.ts';
import { distanceBetween } from './zombie-navigation.ts';

export type HeardGunshot = { readonly position: WorldPosition; readonly expiresAtTick: number };
export const hearGunshot = ({
    position,
    origin,
    shotTick,
    tick,
}: {
    position: WorldPosition;
    origin: WorldPosition;
    shotTick: number;
    tick: number;
}): HeardGunshot | null => {
    const expiresAtTick = shotTick + pistolSettings.noiseInterestTicks;
    const isCurrent = shotTick <= tick && expiresAtTick > tick;
    const isInRange = distanceBetween(position, origin) <= pistolSettings.noiseRadiusMeters;
    return isCurrent && isInRange ? { position: { ...origin }, expiresAtTick } : null;
};
export const stepGunshotInvestigation = ({
    zombie,
    heard,
    tick,
    obstacles,
    stepSeconds,
}: {
    zombie: ZombieState;
    heard: HeardGunshot;
    tick: number;
    obstacles: readonly WorldObstacle[];
    stepSeconds: number;
}): ZombieState => {
    if (stepSeconds !== movementStepSeconds)
        throw new RangeError('Zombie requires the fixed movement step.');
    if (tick >= heard.expiresAtTick) return { ...zombie, targetPlayerId: null };
    return {
        ...zombie,
        targetPlayerId: null,
        position: moveZombieToward({
            position: zombie.position,
            target: heard.position,
            obstacles,
            stepSeconds,
        }),
    };
};
