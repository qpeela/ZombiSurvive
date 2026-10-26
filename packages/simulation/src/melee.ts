import { combatSettings } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition, ZombieState } from '@zombi-survive/domain';

import { distanceBetween, isSegmentClear } from './zombie-navigation.ts';

/** A swing hits only the nearest reachable zombie; positions are authoritative. */
export const findMeleeTarget = ({
    position,
    zombies,
    obstacles,
}: {
    position: WorldPosition;
    zombies: readonly ZombieState[];
    obstacles: readonly WorldObstacle[];
}): ZombieState | undefined =>
    zombies
        .filter(zombie => {
            const isInRange =
                distanceBetween(position, zombie.position) <= combatSettings.meleeRangeMeters;

            return (
                isInRange && isSegmentClear({ start: position, end: zombie.position, obstacles })
            );
        })
        .sort((first, second) => {
            const distance =
                distanceBetween(position, first.position) -
                distanceBetween(position, second.position);

            return distance === 0 ? first.zombieId.localeCompare(second.zombieId) : distance;
        })[0];
