import type { WorldObstacle } from '@zombi-survive/domain';

export const collisionSettings = Object.freeze({ playerHalfSizeMeters: 0.35 });

// Authored starting ruins, translated into each generated chunk.
export const startingRuins: readonly WorldObstacle[] = Object.freeze([
    Object.freeze({
        id: 'east-wall',
        minXMeters: 5,
        minYMeters: -3,
        maxXMeters: 5.5,
        maxYMeters: 3,
    }),
    Object.freeze({
        id: 'north-crate',
        minXMeters: -5,
        minYMeters: -6,
        maxXMeters: -3,
        maxYMeters: -4,
    }),
    Object.freeze({
        id: 'south-wall',
        minXMeters: -3,
        minYMeters: 5,
        maxXMeters: 3,
        maxYMeters: 5.5,
    }),
]);
