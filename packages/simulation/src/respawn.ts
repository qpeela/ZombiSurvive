import { collisionSettings, combatSettings } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition } from '@zombi-survive/domain';

/** Deterministic search near the original start, excluding solid footprints and occupants. */
export const findRespawnPosition = ({
    obstacles,
    occupied,
    zombies,
}: {
    readonly obstacles: readonly WorldObstacle[];
    readonly occupied: readonly WorldPosition[];
    readonly zombies: readonly WorldPosition[];
}): WorldPosition | null => {
    const half = collisionSettings.playerHalfSizeMeters;
    for (let radius = 0; radius <= 32; radius += 2) {
        for (let xMeters = -radius; xMeters <= radius; xMeters += 2) {
            for (let yMeters = -radius; yMeters <= radius; yMeters += 2) {
                const isEdge = Math.abs(xMeters) === radius || Math.abs(yMeters) === radius;
                if (!isEdge) continue;
                const isBlocked = obstacles.some(obstacle => {
                    const overlapsX =
                        xMeters > obstacle.minXMeters - half &&
                        xMeters < obstacle.maxXMeters + half;
                    const overlapsY =
                        yMeters > obstacle.minYMeters - half &&
                        yMeters < obstacle.maxYMeters + half;
                    return overlapsX && overlapsY;
                });
                const isOccupied = occupied.some(
                    position =>
                        Math.hypot(position.xMeters - xMeters, position.yMeters - yMeters) <
                        half * 2,
                );
                const isDangerous = zombies.some(
                    position =>
                        Math.hypot(position.xMeters - xMeters, position.yMeters - yMeters) <=
                        combatSettings.attackRangeMeters + 1,
                );
                if (!isBlocked && !isOccupied && !isDangerous)
                    return { xMeters: xMeters + 0, yMeters: yMeters + 0 };
            }
        }
    }
    return null;
};
