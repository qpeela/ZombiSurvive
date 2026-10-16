import { collisionSettings, prototypeObstacles } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition } from '@zombi-survive/domain';
import { resolveMovement } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const wall: WorldObstacle = Object.freeze({
    id: 'wall',
    minXMeters: 1,
    minYMeters: -2,
    maxXMeters: 2,
    maxYMeters: 2,
});
const position = (xMeters: number, yMeters: number): WorldPosition => ({ xMeters, yMeters });
const isOverlapping = (p: WorldPosition, box: WorldObstacle): boolean => {
    const half = collisionSettings.playerHalfSizeMeters;
    return (
        p.xMeters > box.minXMeters - half &&
        p.xMeters < box.maxXMeters + half &&
        p.yMeters > box.minYMeters - half &&
        p.yMeters < box.maxYMeters + half
    );
};

test('empty space and idle movement are unchanged, finite, and detached', () => {
    const start = Object.freeze(position(-3, -4));
    const end = Object.freeze(position(-2.8, -4.1));
    expect(resolveMovement(start, end, [wall])).toEqual(end);
    expect(resolveMovement(start, start, [wall])).toEqual(start);
    expect(resolveMovement(start, end, [])).not.toBe(end);
});

test.each([
    [position(0, 0), position(3, 0), position(0.65, 0)],
    [position(3, 0), position(0, 0), position(2.35, 0)],
    [position(1.5, -3), position(1.5, 3), position(1.5, -2.35)],
    [position(1.5, 3), position(1.5, -3), position(1.5, 2.35)],
])('all faces stop the whole footprint, including long sweeps', (start, end, expected) => {
    expect(resolveMovement(start, end, [wall])).toEqual(expected);
});

test('a thin obstacle cannot be crossed even when both endpoints are outside it', () => {
    const thin = { ...wall, maxXMeters: 1.001 };
    expect(resolveMovement(position(0, 0), position(10, 0), [thin])).toEqual(position(0.65, 0));
});

test('diagonal movement slides along a face without gaining speed', () => {
    const start = position(0, 0);
    const desired = position(2, 1);
    const next = resolveMovement(start, desired, [wall]);
    expect(next).toEqual(position(0.65, 1));
    expect(Math.hypot(next.xMeters, next.yMeters)).toBeLessThan(Math.hypot(2, 1));
    expect(isOverlapping(next, wall)).toBe(false);
});

test('a diagonal corner impact blocks both axes instead of cutting through', () => {
    const corner = { ...wall, minYMeters: 1 };
    expect(resolveMovement(position(0, 0), position(3, 3), [corner])).toEqual(position(0.65, 0.65));
});

test('touching permits tangential and outward movement, but never inward motion', () => {
    const start = position(0.65, 0);
    expect(resolveMovement(start, position(0.85, 0), [wall])).toEqual(start);
    expect(resolveMovement(start, position(0.65, 1), [wall])).toEqual(position(0.65, 1));
    expect(resolveMovement(start, position(0.45, 0), [wall])).toEqual(position(0.45, 0));
    const corner = position(0.65, -2.35);
    expect(resolveMovement(corner, position(0.85, -2.55), [wall])).toEqual(position(0.85, -2.55));
});

test('the nearest wall and simultaneous corner contacts are independent of obstacle order', () => {
    const farther = { ...wall, id: 'farther', minXMeters: 3, maxXMeters: 4 };
    expect(resolveMovement(position(0, 0), position(6, 0), [farther, wall])).toEqual(
        position(0.65, 0),
    );
    const horizontal = {
        id: 'horizontal',
        minXMeters: -4,
        maxXMeters: 4,
        minYMeters: 1,
        maxYMeters: 2,
    };
    expect(resolveMovement(position(0, 0), position(3, 3), [wall, horizontal])).toEqual(
        position(0.65, 0.65),
    );
    expect(resolveMovement(position(0, 0), position(3, 3), [horizontal, wall])).toEqual(
        position(0.65, 0.65),
    );
});

test('a slide can encounter a second wall during the same step', () => {
    const horizontal = {
        id: 'horizontal',
        minXMeters: -4,
        maxXMeters: 4,
        minYMeters: 1,
        maxYMeters: 2,
    };
    expect(resolveMovement(position(0, 0), position(3, 2), [wall, horizontal])).toEqual(
        position(0.65, 0.65),
    );
});

test('negative-coordinate obstacles and repeated contact do not drift or mutate inputs', () => {
    const negative = Object.freeze({
        id: 'negative',
        minXMeters: -3,
        maxXMeters: -2,
        minYMeters: -3,
        maxYMeters: -2,
    });
    const boxes = Object.freeze([negative]);
    let p = Object.freeze(position(-4, -2.5));
    for (let tick = 0; tick < 100; tick++) {
        p = resolveMovement(p, position(p.xMeters + 0.2, p.yMeters), boxes);
        expect(isOverlapping(p, negative)).toBe(false);
    }
    expect(p).toEqual(position(-3.35, -2.5));
    expect(negative.minXMeters).toBe(-3);
});

test('all prototype spawn points are outside geometry and content is immutable', () => {
    expect(Object.isFrozen(prototypeObstacles)).toBe(true);
    for (const box of prototypeObstacles) {
        expect(Object.isFrozen(box)).toBe(true);
        expect(box.maxXMeters).toBeGreaterThan(box.minXMeters);
        expect(box.maxYMeters).toBeGreaterThan(box.minYMeters);
        for (let index = 0; index < 8; index++)
            expect(isOverlapping(position(index * 2, 0), box)).toBe(false);
    }
});

test('deterministic sweeps never enter rectangles, accelerate, or depend on array order', () => {
    for (let index = 0; index < 500; index++) {
        const start = position((index % 25) * 0.4 - 5, Math.floor(index / 25) * 0.4 - 4);
        if (prototypeObstacles.some(box => isOverlapping(start, box))) continue;
        const angle = index * 2.399963229728653;
        const desired = position(
            start.xMeters + Math.cos(angle) * 0.2,
            start.yMeters + Math.sin(angle) * 0.2,
        );
        const next = resolveMovement(start, desired, prototypeObstacles);
        expect(prototypeObstacles.some(box => isOverlapping(next, box))).toBe(false);
        expect(
            Math.hypot(next.xMeters - start.xMeters, next.yMeters - start.yMeters),
        ).toBeLessThanOrEqual(0.2000000001);
        expect(resolveMovement(start, desired, [...prototypeObstacles].reverse())).toEqual(next);
    }
});
