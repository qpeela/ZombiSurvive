import { pistolSettings } from '@zombi-survive/content';
import type { PistolItem, WorldObstacle, WorldPosition, ZombieState } from '@zombi-survive/domain';

import { obstacleRayDistance } from './obstacle-ray.ts';

/** Compare-and-set the instance, so a retry remains harmless after cooldown/restart. */
export const spendPistolRound = (pistol: PistolItem, revision: number): PistolItem | null => {
    const current = pistol.revision ?? 0;
    const isReady = pistol.rounds > 0 && current === revision && current < Number.MAX_SAFE_INTEGER;
    if (!isReady) return null;
    return { ...pistol, rounds: pistol.rounds - 1, revision: current + 1 };
};

/** First intersection wins; walls win ties. Targets include visible, non-pursuing zombies. */
export const tracePistolShot = ({
    origin,
    aim,
    zombies,
    obstacles,
}: {
    origin: WorldPosition;
    aim: { readonly x: number; readonly y: number };
    zombies: readonly ZombieState[];
    obstacles: readonly WorldObstacle[];
}): { readonly position: WorldPosition; readonly zombie: ZombieState | null } | null => {
    const length = Math.hypot(aim.x, aim.y);
    if (!Number.isFinite(length) || length <= 1e-6) return null;
    const direction = { x: aim.x / length, y: aim.y / length };
    let distance: number = pistolSettings.rangeMeters;
    let hasWall = false;
    for (const wall of obstacles) {
        const hit = obstacleRayDistance({
            origin,
            direction,
            wall,
            rangeMeters: pistolSettings.rangeMeters,
        });
        if (hit !== null && hit <= distance) {
            distance = hit;
            hasWall = true;
        }
    }
    let target: ZombieState | null = null;
    const radius = pistolSettings.targetRadiusMeters;
    for (const zombie of zombies) {
        const x = zombie.position.xMeters - origin.xMeters;
        const y = zombie.position.yMeters - origin.yMeters;
        const projection = x * direction.x + y * direction.y;
        const squared = x * x + y * y;
        if (squared > (pistolSettings.rangeMeters + radius) ** 2) continue;
        const perpendicular = Math.max(0, squared - projection * projection);
        if (perpendicular > radius * radius) continue;
        const extent = Math.sqrt(Math.max(0, radius * radius - perpendicular));
        if (projection + extent < 0) continue;
        const hit = Math.max(0, projection - extent);
        const isBefore = hit < distance;
        const isTie =
            hit === distance &&
            !hasWall &&
            (target === null || zombie.zombieId.localeCompare(target.zombieId) < 0);
        if (isBefore || isTie) {
            distance = hit;
            target = zombie;
            hasWall = false;
        }
    }
    return {
        zombie: target,
        position: {
            xMeters: origin.xMeters + direction.x * distance,
            yMeters: origin.yMeters + direction.y * distance,
        },
    };
};
