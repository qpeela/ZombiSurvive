import { type DaylightPhase, daylightPhases, flashlightSettings } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition } from '@zombi-survive/domain';

import { obstacleRayDistance } from './obstacle-ray.ts';

export const isWithinFlashlightAngle = ({
    angleRadians,
    facingAngleRadians,
}: {
    readonly angleRadians: number;
    readonly facingAngleRadians: number;
}): boolean => {
    const difference = angleRadians - facingAngleRadians;
    const wrapped = Math.atan2(Math.sin(difference), Math.cos(difference));

    return Math.abs(wrapped) <= flashlightSettings.halfAngleRadians + 1e-12;
};

/** Presentation visibility; pickups and combat still require host validation. */
export const isPositionVisible = ({
    observer,
    target,
    phase,
    flashlight,
    obstacles = [],
}: {
    readonly observer: WorldPosition | null;
    readonly target: WorldPosition;
    readonly phase: DaylightPhase | null;
    readonly obstacles?: readonly WorldObstacle[];
    readonly flashlight?: { readonly angleRadians: number };
}): boolean => {
    if (observer === null) return false;

    // Legacy v5 snapshots have no clock; retain their existing daylight range.
    const radius = daylightPhases[phase ?? 'day'].visibilityMeters;
    const deltaX = target.xMeters - observer.xMeters;
    const deltaY = target.yMeters - observer.yMeters;
    const distance = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(distance)) return false;

    if (distance > radius) {
        if (flashlight === undefined || distance > flashlightSettings.rangeMeters) return false;

        const isInBeam = isWithinFlashlightAngle({
            angleRadians: Math.atan2(deltaY, deltaX),
            facingAngleRadians: flashlight.angleRadians,
        });
        if (!isInBeam) return false;
    }

    const direction =
        distance === 0 ? { x: 0, y: 0 } : { x: deltaX / distance, y: deltaY / distance };
    const isBlocked = obstacles.some(wall => {
        const hit = obstacleRayDistance({
            origin: observer,
            direction,
            wall,
            rangeMeters: distance,
        });

        return hit !== null && hit < distance;
    });
    return !isBlocked;
};
