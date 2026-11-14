import { zombieSettings } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition } from '@zombi-survive/domain';

import { resolveMovement } from './collisions.ts';
import { distanceBetween, findZombieWaypoint } from './zombie-navigation.ts';

export const moveZombieToward = ({
    position,
    target,
    obstacles,
    stepSeconds,
}: {
    position: WorldPosition;
    target: WorldPosition;
    obstacles: readonly WorldObstacle[];
    stepSeconds: number;
}): WorldPosition => {
    const distance = distanceBetween(position, target);
    if (distance <= zombieSettings.stopRangeMeters) return position;
    const waypoint = findZombieWaypoint({ start: position, target, obstacles });
    if (waypoint === null) return position;
    const waypointDistance = distanceBetween(position, waypoint);
    if (waypointDistance === 0) return position;
    const travel = Math.min(
        zombieSettings.speedMetersPerSecond * stepSeconds,
        waypointDistance,
        distance - zombieSettings.stopRangeMeters,
    );
    const ratio = travel / waypointDistance;
    return resolveMovement(
        position,
        {
            xMeters: position.xMeters + (waypoint.xMeters - position.xMeters) * ratio,
            yMeters: position.yMeters + (waypoint.yMeters - position.yMeters) * ratio,
        },
        obstacles,
    );
};
