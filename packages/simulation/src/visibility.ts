import {
    type DaylightPhase,
    daylightPhases,
    flashlightSettings,
    fogSettings,
    type WorldWeather,
} from '@zombi-survive/content';
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

/** One set of distances for entity visibility and the light/mist drawing. */
export const getVisibilityRanges = ({
    phase,
    weather,
}: {
    readonly phase: DaylightPhase | null;
    readonly weather?: WorldWeather | null;
}): { readonly ambientMeters: number; readonly flashlightMeters: number } => {
    const ambientMeters = daylightPhases[phase ?? 'day'].visibilityMeters;
    if (weather !== 'fog')
        return { ambientMeters, flashlightMeters: flashlightSettings.rangeMeters };

    return {
        ambientMeters: Math.min(ambientMeters, fogSettings.visibilityMeters),
        flashlightMeters: fogSettings.flashlightRangeMeters,
    };
};

/** Presentation visibility; pickups and combat still require host validation. */
export const isPositionVisible = ({
    observer,
    target,
    phase,
    weather,
    flashlight,
    obstacles = [],
}: {
    readonly observer: WorldPosition | null;
    readonly target: WorldPosition;
    readonly phase: DaylightPhase | null;
    readonly weather?: WorldWeather | null;
    readonly obstacles?: readonly WorldObstacle[];
    readonly flashlight?: { readonly angleRadians: number };
}): boolean => {
    if (observer === null) return false;

    // Legacy v5 snapshots have no clock; retain their existing daylight range.
    const { ambientMeters, flashlightMeters } = getVisibilityRanges({
        phase,
        weather: weather ?? null,
    });
    const deltaX = target.xMeters - observer.xMeters;
    const deltaY = target.yMeters - observer.yMeters;
    const distance = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(distance)) return false;

    if (distance > ambientMeters) {
        if (flashlight === undefined || distance > flashlightMeters) return false;

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
