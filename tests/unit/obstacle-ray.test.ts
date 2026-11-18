import { obstacleRayDistance } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const wall = { id: 'wall', minXMeters: 4, maxXMeters: 5, minYMeters: -2, maxYMeters: 2 };
const origin = { xMeters: 0, yMeters: 0 };

test('rays stop at the nearest face, including tangent corners and parallel edges', () => {
    expect(obstacleRayDistance({ origin, direction: { x: 1, y: 0 }, wall, rangeMeters: 12 })).toBe(
        4,
    );
    expect(
        obstacleRayDistance({
            origin: { xMeters: 0, yMeters: -2 },
            direction: { x: 1, y: 0 },
            wall,
            rangeMeters: 12,
        }),
    ).toBe(4);
    expect(
        obstacleRayDistance({
            origin: { xMeters: 0, yMeters: -2.001 },
            direction: { x: 1, y: 0 },
            wall,
            rangeMeters: 12,
        }),
    ).toBeNull();
    expect(
        obstacleRayDistance({ origin, direction: { x: 1, y: 0 }, wall, rangeMeters: 3.99 }),
    ).toBeNull();
    expect(
        obstacleRayDistance({ origin, direction: { x: -1, y: 0 }, wall, rangeMeters: 12 }),
    ).toBeNull();
});

test('inside origins stop immediately and perpendicular rays work in negative coordinates', () => {
    expect(
        obstacleRayDistance({
            origin: { xMeters: 4.5, yMeters: 0 },
            direction: { x: 0, y: 1 },
            wall,
            rangeMeters: 12,
        }),
    ).toBe(0);
    expect(
        obstacleRayDistance({
            origin: { xMeters: 4.5, yMeters: -8 },
            direction: { x: 0, y: 1 },
            wall,
            rangeMeters: 12,
        }),
    ).toBe(6);
});
