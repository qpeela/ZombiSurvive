import { collisionSettings } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition } from '@zombi-survive/domain';

type AxisInterval = { readonly entry: number; readonly exit: number };
type Contact = { readonly time: number; readonly x: number | null; readonly y: number | null };
const contactTolerance = 1e-10;

const sweepAxis = (start: number, delta: number, min: number, max: number): AxisInterval | null => {
    if (delta === 0) {
        // Touching a face is allowed; a parallel move must not catch on its edge.
        if (start <= min || start >= max) {
            return null;
        }

        return { entry: -Infinity, exit: Infinity };
    }

    const first = (min - start) / delta;
    const second = (max - start) / delta;

    return { entry: Math.min(first, second), exit: Math.max(first, second) };
};

const sweepObstacle = (
    start: WorldPosition,
    delta: WorldPosition,
    obstacle: WorldObstacle,
): Contact | null => {
    const half = collisionSettings.playerHalfSizeMeters;
    const minX = obstacle.minXMeters - half;
    const maxX = obstacle.maxXMeters + half;
    const minY = obstacle.minYMeters - half;
    const maxY = obstacle.maxYMeters + half;
    const x = sweepAxis(start.xMeters, delta.xMeters, minX, maxX);
    const y = sweepAxis(start.yMeters, delta.yMeters, minY, maxY);

    if (x === null || y === null) {
        return null;
    }

    const entry = Math.max(x.entry, y.entry);
    const exit = Math.min(x.exit, y.exit);
    const isWithinStep = entry >= 0 && entry <= 1;
    const entersInterior = entry < exit;

    if (!isWithinStep || !entersInterior) {
        return null;
    }

    const hitsX = Math.abs(x.entry - entry) <= contactTolerance;
    const hitsY = Math.abs(y.entry - entry) <= contactTolerance;
    const faceX = delta.xMeters > 0 ? minX : maxX;
    const faceY = delta.yMeters > 0 ? minY : maxY;

    return {
        time: entry,
        x: hitsX ? faceX : null,
        y: hitsY ? faceY : null,
    };
};

/** Sweep a square footprint, then slide the remainder along the contacted face.
 * The caller supplies a valid, non-overlapping start and validated static geometry.
 */
export const resolveMovement = (
    start: WorldPosition,
    desired: WorldPosition,
    obstacles: readonly WorldObstacle[],
): WorldPosition => {
    let position = { ...start };
    let delta = {
        xMeters: desired.xMeters - start.xMeters,
        yMeters: desired.yMeters - start.yMeters,
    };

    // Each contact removes an axis; two contacts suffice in a 2D static level.
    for (let iteration = 0; iteration < 2; iteration++) {
        let nearest: Contact | null = null;

        for (const obstacle of obstacles) {
            const hit = sweepObstacle(position, delta, obstacle);

            if (hit === null) {
                continue;
            }

            if (nearest === null || hit.time < nearest.time - contactTolerance) {
                nearest = hit;
            } else if (Math.abs(hit.time - nearest.time) <= contactTolerance) {
                nearest = {
                    time: Math.min(hit.time, nearest.time),
                    x: nearest.x ?? hit.x,
                    y: nearest.y ?? hit.y,
                };
            }
        }

        if (nearest === null) {
            return {
                xMeters: position.xMeters + delta.xMeters,
                yMeters: position.yMeters + delta.yMeters,
            };
        }

        position = {
            xMeters: nearest.x ?? position.xMeters + delta.xMeters * nearest.time,
            yMeters: nearest.y ?? position.yMeters + delta.yMeters * nearest.time,
        };
        delta = {
            xMeters: nearest.x === null ? delta.xMeters * (1 - nearest.time) : 0,
            yMeters: nearest.y === null ? delta.yMeters * (1 - nearest.time) : 0,
        };
    }

    return position;
};
