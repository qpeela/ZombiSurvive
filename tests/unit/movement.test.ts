import { movementSettings } from '@zombi-survive/content';
import type { MovementDirection, PlayerMovementState } from '@zombi-survive/domain';
import { movementStepSeconds, stepPlayerMovement } from '@zombi-survive/simulation';
import { describe, expect, test } from 'vitest';

const player: PlayerMovementState = {
    playerId: 'player-1',
    position: { xMeters: 12.25, yMeters: -8.5 },
};
const directions: readonly MovementDirection[] = [
    { x: -1, y: -1 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: -1 },
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
];

const advanceSecond = (direction: MovementDirection): PlayerMovementState => {
    let state = player;

    for (let tick = 0; tick < movementSettings.ticksPerSecond; tick++) {
        state = stepPlayerMovement(state, direction, movementStepSeconds);
    }

    return state;
};

describe('fixed movement step', () => {
    test.each(directions)(
        'applies direction $x, $y in world axes without a diagonal speed bonus',
        direction => {
            const next = stepPlayerMovement(player, direction, movementStepSeconds);
            const xMeters = next.position.xMeters - player.position.xMeters;
            const yMeters = next.position.yMeters - player.position.yMeters;
            const isIdle = direction.x === 0 && direction.y === 0;

            expect(next.playerId).toBe(player.playerId);
            expect(Math.sign(xMeters)).toBe(direction.x);
            expect(Math.sign(yMeters)).toBe(direction.y);
            expect(Math.hypot(xMeters, yMeters)).toBeCloseTo(isIdle ? 0 : 0.2, 12);
        },
    );

    test('twenty ticks cover four meters along an axis and along a diagonal', () => {
        const axis = advanceSecond({ x: 1, y: 0 });
        const diagonal = advanceSecond({ x: 1, y: -1 });

        expect(axis.position.xMeters).toBeCloseTo(16.25, 12);
        expect(axis.position.yMeters).toBe(-8.5);
        expect(
            Math.hypot(
                diagonal.position.xMeters - player.position.xMeters,
                diagonal.position.yMeters - player.position.yMeters,
            ),
        ).toBeCloseTo(4, 12);
    });

    test('idle ticks keep the position finite and unchanged', () => {
        expect(advanceSecond({ x: 0, y: 0 })).toEqual(player);
    });

    test('opposite inputs return to the initial position, including negative coordinates', () => {
        const moved = stepPlayerMovement(player, { x: -1, y: -1 }, movementStepSeconds);
        const returned = stepPlayerMovement(moved, { x: 1, y: 1 }, movementStepSeconds);

        expect(returned.position.xMeters).toBeCloseTo(player.position.xMeters, 12);
        expect(returned.position.yMeters).toBeCloseTo(player.position.yMeters, 12);
    });

    test('does not mutate frozen inputs or reuse their position for movement or idle', () => {
        const source = Object.freeze({
            ...player,
            position: Object.freeze({ ...player.position }),
        });

        for (const direction of directions) {
            const intention = Object.freeze({ ...direction });
            const next = stepPlayerMovement(source, intention, movementStepSeconds);

            expect(next).not.toBe(source);
            expect(next.position).not.toBe(source.position);
            expect(source).toEqual(player);
            expect(intention).toEqual(direction);
        }
    });

    test('replaying the same ordered inputs produces the same result', () => {
        const replay = (): PlayerMovementState =>
            directions.reduce(
                (state, direction) => stepPlayerMovement(state, direction, movementStepSeconds),
                player,
            );

        expect(replay()).toEqual(replay());
    });

    test.each([0, -0.05, 0.016, 0.1, NaN, Infinity, -Infinity])(
        'rejects a non-fixed step %s without mutation',
        stepSeconds => {
            const original = { ...player.position };

            expect(() => stepPlayerMovement(player, { x: 1, y: 0 }, stepSeconds)).toThrow(
                RangeError,
            );
            expect(player.position).toEqual(original);
        },
    );
});
