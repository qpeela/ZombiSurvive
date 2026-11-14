import { pistolSettings } from '@zombi-survive/content';
import type { PistolItem, WorldObstacle, WorldPosition, ZombieState } from '@zombi-survive/domain';

/** Compare-and-set the instance, so a retry remains harmless after cooldown/restart. */
export const spendPistolRound = (pistol: PistolItem, revision: number): PistolItem | null => {
    const current = pistol.revision ?? 0;
    const isReady = pistol.rounds > 0 && current === revision && current < Number.MAX_SAFE_INTEGER;
    if (!isReady) return null;
    return { ...pistol, rounds: pistol.rounds - 1, revision: current + 1 };
};

const wallDistance = (input: {
    origin: WorldPosition;
    direction: { x: number; y: number };
    wall: WorldObstacle;
}): number | null => {
    let near = 0;
    let far: number = pistolSettings.rangeMeters;
    const { origin, direction, wall } = input;
    const axes = [
        [origin.xMeters, direction.x, wall.minXMeters, wall.maxXMeters],
        [origin.yMeters, direction.y, wall.minYMeters, wall.maxYMeters],
    ] as const;
    for (const [start, delta, min, max] of axes) {
        if (Math.abs(delta) < 1e-12) {
            if (start < min || start > max) return null;
            continue;
        }
        const first = (min - start) / delta;
        const second = (max - start) / delta;
        near = Math.max(near, Math.min(first, second));
        far = Math.min(far, Math.max(first, second));
        if (near > far) return null;
    }
    return near;
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
        const hit = wallDistance({ origin, direction, wall });
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
