import { type DaylightPhase, daylightPhases, flashlightSettings } from '@zombi-survive/content';
import type { WorldPosition } from '@zombi-survive/domain';

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
}: {
    readonly observer: WorldPosition | null;
    readonly target: WorldPosition;
    readonly phase: DaylightPhase | null;
    readonly flashlight?: { readonly angleRadians: number };
}): boolean => {
    if (observer === null) return false;

    // Legacy v5 snapshots have no clock; retain their existing daylight range.
    const radius = daylightPhases[phase ?? 'day'].visibilityMeters;
    const deltaX = target.xMeters - observer.xMeters;
    const deltaY = target.yMeters - observer.yMeters;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= radius) return true;

    if (flashlight === undefined || distance > flashlightSettings.rangeMeters) return false;

    return isWithinFlashlightAngle({
        angleRadians: Math.atan2(deltaY, deltaX),
        facingAngleRadians: flashlight.angleRadians,
    });
};
