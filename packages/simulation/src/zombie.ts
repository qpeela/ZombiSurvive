import { zombieSettings } from '@zombi-survive/content';
import type { PlayerMovementState, WorldObstacle, ZombieState } from '@zombi-survive/domain';

import { resolveMovement } from './collisions.ts';
import { movementStepSeconds } from './movement.ts';
import { distanceBetween, findZombieWaypoint, isSegmentClear } from './zombie-navigation.ts';

/** Only connected players participate. Inputs are server-owned, validated world state. */
export const stepZombie = ({
    zombie,
    players,
    obstacles,
    stepSeconds,
}: {
    zombie: ZombieState;
    players: readonly PlayerMovementState[];
    obstacles: readonly WorldObstacle[];
    stepSeconds: number;
}): ZombieState => {
    if (stepSeconds !== movementStepSeconds) {
        throw new RangeError('Zombie requires the fixed movement step.');
    }

    let target = players.find(player => {
        const isCurrentTarget = player.playerId === zombie.targetPlayerId;
        const isInRange =
            distanceBetween(zombie.position, player.position) <= zombieSettings.pursuitRangeMeters;

        return isCurrentTarget && isInRange;
    });

    if (target === undefined) {
        const visible = players.filter(player => {
            const isInSight =
                distanceBetween(zombie.position, player.position) <=
                zombieSettings.sightRangeMeters;

            return (
                isInSight &&
                isSegmentClear({ start: zombie.position, end: player.position, obstacles })
            );
        });
        visible.sort((first, second) => {
            const difference =
                distanceBetween(zombie.position, first.position) -
                distanceBetween(zombie.position, second.position);

            if (difference !== 0) {
                return difference;
            }

            return first.playerId < second.playerId ? -1 : Number(first.playerId > second.playerId);
        });
        target = visible[0];
    }

    if (target === undefined) {
        return { ...zombie, targetPlayerId: null };
    }

    const next = { ...zombie, targetPlayerId: target.playerId };
    const distance = distanceBetween(zombie.position, target.position);

    if (distance <= zombieSettings.stopRangeMeters) {
        return next;
    }

    const waypoint = findZombieWaypoint({
        start: zombie.position,
        target: target.position,
        obstacles,
    });

    if (waypoint === null) {
        return next;
    }

    const waypointDistance = distanceBetween(zombie.position, waypoint);
    const travel = Math.min(
        zombieSettings.speedMetersPerSecond * stepSeconds,
        waypointDistance,
        distance - zombieSettings.stopRangeMeters,
    );

    if (waypointDistance === 0) {
        return next;
    }

    const ratio = travel / waypointDistance;
    const desired = {
        xMeters: zombie.position.xMeters + (waypoint.xMeters - zombie.position.xMeters) * ratio,
        yMeters: zombie.position.yMeters + (waypoint.yMeters - zombie.position.yMeters) * ratio,
    };

    return { ...next, position: resolveMovement(zombie.position, desired, obstacles) };
};
