import { zombieSettings } from '@zombi-survive/content';
import type { PlayerMovementState, WorldObstacle, ZombieState } from '@zombi-survive/domain';

import { movementStepSeconds } from './movement.ts';
import { moveZombieToward } from './zombie-movement.ts';
import { distanceBetween, isSegmentClear } from './zombie-navigation.ts';

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

    return {
        ...zombie,
        targetPlayerId: target.playerId,
        position: moveZombieToward({
            position: zombie.position,
            target: target.position,
            obstacles,
            stepSeconds,
        }),
    };
};
