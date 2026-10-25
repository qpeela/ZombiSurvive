import { collisionSettings, zombieSettings } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition } from '@zombi-survive/domain';

export const distanceBetween = (first: WorldPosition, second: WorldPosition): number =>
    Math.hypot(second.xMeters - first.xMeters, second.yMeters - first.yMeters);

/** Open rectangle interiors block sight; touching a face or corner is allowed. */
export const isSegmentClear = ({
    start,
    end,
    obstacles,
    clearanceMeters = 0,
}: {
    start: WorldPosition;
    end: WorldPosition;
    obstacles: readonly WorldObstacle[];
    clearanceMeters?: number;
}): boolean =>
    !obstacles.some(obstacle => {
        let entry = 0;
        let exit = 1;
        const axes = [
            [start.xMeters, end.xMeters, obstacle.minXMeters, obstacle.maxXMeters],
            [start.yMeters, end.yMeters, obstacle.minYMeters, obstacle.maxYMeters],
        ] as const;

        for (const [from, to, lower, upper] of axes) {
            const min = lower - clearanceMeters;
            const max = upper + clearanceMeters;
            const delta = to - from;

            if (delta === 0) {
                if (from <= min || from >= max) {
                    return false;
                }

                continue;
            }

            const first = (min - from) / delta;
            const second = (max - from) / delta;
            entry = Math.max(entry, Math.min(first, second));
            exit = Math.min(exit, Math.max(first, second));

            if (entry >= exit) {
                return false;
            }
        }

        return entry < exit;
    });

/** Visibility graph in a bounded local window. No route means no movement. */
export const findZombieWaypoint = ({
    start,
    target,
    obstacles,
}: {
    start: WorldPosition;
    target: WorldPosition;
    obstacles: readonly WorldObstacle[];
}): WorldPosition | null => {
    const half = collisionSettings.playerHalfSizeMeters;
    const isClear = (from: WorldPosition, to: WorldPosition): boolean =>
        isSegmentClear({ start: from, end: to, obstacles, clearanceMeters: half });

    if (isClear(start, target)) {
        return target;
    }

    const margin = zombieSettings.navigationMarginMeters;
    const minX = Math.min(start.xMeters, target.xMeters) - margin;
    const maxX = Math.max(start.xMeters, target.xMeters) + margin;
    const minY = Math.min(start.yMeters, target.yMeters) - margin;
    const maxY = Math.max(start.yMeters, target.yMeters) + margin;
    const padding = half + 0.01;
    const nodes: WorldPosition[] = [start, target];

    for (const obstacle of obstacles) {
        const isNearbyX =
            obstacle.maxXMeters + padding >= minX && obstacle.minXMeters - padding <= maxX;
        const isNearbyY =
            obstacle.maxYMeters + padding >= minY && obstacle.minYMeters - padding <= maxY;

        if (!isNearbyX || !isNearbyY) {
            continue;
        }

        for (const xMeters of [obstacle.minXMeters - padding, obstacle.maxXMeters + padding]) {
            for (const yMeters of [obstacle.minYMeters - padding, obstacle.maxYMeters + padding]) {
                const isInsideX = xMeters >= minX && xMeters <= maxX;
                const isInsideY = yMeters >= minY && yMeters <= maxY;
                const point = { xMeters, yMeters };

                if (isInsideX && isInsideY && isClear(point, point)) {
                    nodes.push(point);
                }
            }
        }
    }

    const costs = nodes.map(() => Infinity);
    const firstSteps: (WorldPosition | null)[] = nodes.map(() => null);
    const visited = new Set<number>();
    costs[0] = 0;

    for (let iteration = 0; iteration < nodes.length; iteration++) {
        let current = -1;
        let best = Infinity;

        for (const [index, cost] of costs.entries()) {
            if (!visited.has(index) && cost < best) {
                current = index;
                best = cost;
            }
        }

        if (current === -1) {
            return null;
        }

        if (current === 1) {
            return firstSteps[current] ?? null;
        }

        visited.add(current);
        const from = nodes[current];

        if (from === undefined) {
            return null;
        }

        for (const [index, point] of nodes.entries()) {
            if (visited.has(index)) {
                continue;
            }

            const cost = best + distanceBetween(from, point);

            if (cost < (costs[index] ?? Infinity) && isClear(from, point)) {
                costs[index] = cost;
                firstSteps[index] = current === 0 ? point : (firstSteps[current] ?? null);
            }
        }
    }

    return null;
};
