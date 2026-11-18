import { type DaylightPhase, daylightPhases } from '@zombi-survive/content';
import type { WorldPosition } from '@zombi-survive/domain';

/** Presentation visibility; pickups and combat still require host validation. */
export const isPositionVisible = ({
    observer,
    target,
    phase,
}: {
    readonly observer: WorldPosition | null;
    readonly target: WorldPosition;
    readonly phase: DaylightPhase | null;
}): boolean => {
    if (observer === null) return false;

    // Legacy v5 snapshots have no clock; retain their existing daylight range.
    const radius = daylightPhases[phase ?? 'day'].visibilityMeters;

    return (
        Math.hypot(target.xMeters - observer.xMeters, target.yMeters - observer.yMeters) <= radius
    );
};
