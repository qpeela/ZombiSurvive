import type { WorldObstacle, WorldPosition } from '@zombi-survive/domain';

/** Closed ray/AABB intersection in meters; a ray beginning inside a wall stops immediately. */
export const obstacleRayDistance = (input: {
    origin: WorldPosition;
    direction: { x: number; y: number };
    wall: WorldObstacle;
    rangeMeters: number;
}): number | null => {
    let near = 0;
    let far: number = input.rangeMeters;
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
