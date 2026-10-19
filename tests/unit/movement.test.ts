import { movementSettings } from '@zombi-survive/content';
import type { MovementDirection, PlayerMovementState } from '@zombi-survive/domain';
import {
    movementStepSeconds,
    stepPlayerMovement,
    stepPlayerToward,
} from '@zombi-survive/simulation';
import { describe, expect, test } from 'vitest';

const player: PlayerMovementState = {
    playerId: 'player-1',
    stamina: 1,
    isExhausted: false,
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

describe('movement toward a mouse destination', () => {
    test('arbitrary directions keep the walking speed and clamp the final step', () => {
        const target = {
            xMeters: player.position.xMeters - 0.3,
            yMeters: player.position.yMeters + 0.4,
        };
        const first = stepPlayerToward(player, target, movementStepSeconds);
        expect(
            Math.hypot(
                first.position.xMeters - player.position.xMeters,
                first.position.yMeters - player.position.yMeters,
            ),
        ).toBeCloseTo(0.2, 12);
        const second = stepPlayerToward(first, target, movementStepSeconds);
        const arrived = stepPlayerToward(second, target, movementStepSeconds);
        expect(arrived).toEqual({ ...player, position: target });
        expect(stepPlayerToward(arrived, target, movementStepSeconds)).toEqual(arrived);
        expect(player.position).toEqual({ xMeters: 12.25, yMeters: -8.5 });
        expect(arrived.position).not.toBe(target);
    });

    test('a target under the player remains finite and a short step never overshoots', () => {
        expect(stepPlayerToward(player, player.position, movementStepSeconds)).toEqual(player);
        const target = { xMeters: 12.26, yMeters: -8.49 };
        expect(stepPlayerToward(player, target, movementStepSeconds).position).toEqual(target);
    });

    test.each([0, -0.05, 0.1, NaN, Infinity])('rejects non-fixed mouse step %s', step => {
        expect(() => stepPlayerToward(player, { xMeters: 0, yMeters: 0 }, step)).toThrow(
            RangeError,
        );
    });
});

describe('sprint and stamina', () => {
    test.each([
        { x: 1, y: 0 },
        { x: -1, y: -1 },
    ] as const)('sprints seven meters per second without a diagonal bonus: %o', direction => {
        let state = player;
        for (let tick = 0; tick < 20; tick++) {
            state = stepPlayerMovement(state, direction, movementStepSeconds, true);
        }
        expect(
            Math.hypot(
                state.position.xMeters - player.position.xMeters,
                state.position.yMeters - player.position.yMeters,
            ),
        ).toBeCloseTo(7, 12);
        expect(state.stamina).toBeCloseTo(0.8, 12);
        expect(state.isExhausted).toBe(false);
        expect(player.stamina).toBe(1);
    });

    test('exhaustion forces walking until twenty percent is recovered even while Shift stays held', () => {
        let state = player;
        for (let tick = 0; tick < 100; tick++) {
            state = stepPlayerMovement(state, { x: 1, y: 0 }, movementStepSeconds, true);
        }
        expect(state.stamina).toBe(0);
        expect(state.isExhausted).toBe(true);
        for (let tick = 0; tick < 40; tick++) {
            const previousX = state.position.xMeters;
            state = stepPlayerMovement(state, { x: 1, y: 0 }, movementStepSeconds, true);
            expect(state.position.xMeters - previousX).toBeCloseTo(0.2, 12);
        }
        expect(state.stamina).toBeCloseTo(0.2, 12);
        expect(state.isExhausted).toBe(false);
        const running = stepPlayerMovement(state, { x: 1, y: 0 }, movementStepSeconds, true);
        expect(running.position.xMeters - state.position.xMeters).toBeCloseTo(0.35, 12);
        expect(running.stamina).toBeLessThan(state.stamina);
    });

    test.each([false, true])(
        'idle recovers with Shift=%s and walking also recovers, capped at full',
        isSprinting => {
            const depleted = { ...player, stamina: 0, isExhausted: true };
            let state = depleted;
            for (let tick = 0; tick < 250; tick++) {
                state = stepPlayerMovement(state, { x: 0, y: 0 }, movementStepSeconds, isSprinting);
            }
            expect(state).toEqual(player);
            const walking = stepPlayerMovement(depleted, { x: 1, y: 0 }, movementStepSeconds);
            expect(walking.stamina).toBeCloseTo(0.005, 12);
            expect(walking.isExhausted).toBe(true);
        },
    );

    test('zero reserve cannot sprint even if the exhaustion flag was not set', () => {
        const next = stepPlayerMovement(
            { ...player, stamina: 0 },
            { x: 1, y: 0 },
            movementStepSeconds,
            true,
        );
        expect(next.position.xMeters - player.position.xMeters).toBeCloseTo(0.2, 12);
        expect(next.stamina).toBeGreaterThan(0);
    });

    test('mouse sprint clamps arrival, then recovers at the destination with Shift held', () => {
        const source = { ...player, stamina: 0.5 };
        const target = { xMeters: source.position.xMeters + 0.3, yMeters: source.position.yMeters };
        const arrived = stepPlayerToward(source, target, movementStepSeconds, true);
        expect(arrived.position).toEqual(target);
        expect(arrived.stamina).toBeCloseTo(0.49, 12);
        const idle = stepPlayerToward(arrived, target, movementStepSeconds, true);
        expect(idle.position).toEqual(target);
        expect(idle.stamina).toBeCloseTo(0.495, 12);
    });
});
