import { initialZombie, zombieSettings } from '@zombi-survive/content';
import type { PlayerMovementState, WorldObstacle, ZombieState } from '@zombi-survive/domain';
import { movementStepSeconds, resolveMovement, stepZombie } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const player = (xMeters: number, yMeters = 0, playerId = 'player'): PlayerMovementState => ({
    playerId,
    position: { xMeters, yMeters },
    stamina: 1,
    isExhausted: false,
    isSneaking: false,
    noiseRadiusMeters: 0,
});
const wall: WorldObstacle = {
    id: 'wall',
    minXMeters: -1,
    maxXMeters: 0,
    minYMeters: -3,
    maxYMeters: 3,
};
const step = (
    zombie: ZombieState,
    players: readonly PlayerMovementState[],
    obstacles: readonly WorldObstacle[] = [],
) => stepZombie({ zombie, players, obstacles, stepSeconds: movementStepSeconds });

test('sight needs range and unobstructed geometry; nearest visible player wins deterministically', () => {
    expect(step(initialZombie, [player(5)]).targetPlayerId).toBeNull();
    expect(step(initialZombie, [player(2)], [wall])).toEqual(initialZombie);
    const forward = step(initialZombie, [player(-10, 0, 'b'), player(-6, 0, 'a')]);
    const reverse = step(initialZombie, [player(-6, 0, 'a'), player(-10, 0, 'b')]);
    expect(forward).toEqual(reverse);
    expect(forward.targetPlayerId).toBe('a');
    expect(step(initialZombie, [player(-7, 0, 'near'), player(0)]).targetPlayerId).toBe('near');
});

test('fixed speed is independent of diagonal direction and stops without overshooting', () => {
    for (const target of [player(0), player(-2, 6)]) {
        const next = step(initialZombie, [target]);
        expect(Math.hypot(next.position.xMeters + 8, next.position.yMeters)).toBeCloseTo(
            zombieSettings.speedMetersPerSecond * movementStepSeconds,
            12,
        );
    }
    let zombie = initialZombie;
    for (let tick = 0; tick < 300; tick++) zombie = step(zombie, [player(0)]);
    expect(zombie.position.xMeters).toBeCloseTo(-zombieSettings.stopRangeMeters, 10);
    expect(step(zombie, [player(0)])).toEqual(zombie);
    expect(initialZombie.position).toEqual({ xMeters: -8, yMeters: 0 });
    expect(() => stepZombie({ zombie, players: [], obstacles: [], stepSeconds: 0.1 })).toThrow(
        RangeError,
    );
});

test('an acquired target remains behind a wall and the zombie walks around it without clipping', () => {
    let zombie = step(initialZombie, [player(-2)]);
    const target = player(2);
    let hasPassedWall = false;
    for (let tick = 0; tick < 400; tick++) {
        const next = step(zombie, [target], [wall]);
        const resolved = resolveMovement(zombie.position, next.position, [wall]);
        expect(resolved.xMeters).toBeCloseTo(next.position.xMeters, 10);
        expect(resolved.yMeters).toBeCloseTo(next.position.yMeters, 10);
        expect(
            Math.hypot(
                next.position.xMeters - zombie.position.xMeters,
                next.position.yMeters - zombie.position.yMeters,
            ),
        ).toBeLessThanOrEqual(0.07500001);
        if (next.position.xMeters > 0.35) hasPassedWall = true;
        expect(next.targetPlayerId).toBe('player');
        zombie = next;
    }
    expect(hasPassedWall).toBe(true);
    expect(Math.hypot(zombie.position.xMeters - 2, zombie.position.yMeters)).toBeCloseTo(
        zombieSettings.stopRangeMeters,
        8,
    );
});

test('no local route stops safely; disconnected or distant targets are released', () => {
    const zombie = { ...initialZombie, targetPlayerId: 'player' };
    const tallWall = { ...wall, minYMeters: -100, maxYMeters: 100 };
    expect(step(zombie, [player(2)], [tallWall]).position).toEqual(zombie.position);
    expect(step(zombie, []).targetPlayerId).toBeNull();
    expect(step(zombie, [player(20)]).targetPlayerId).toBeNull();
    expect(step(zombie, [player(20), player(-6, 0, 'new')]).targetPlayerId).toBe('new');
});

test('overlapping obstacle corners remain impassable and a multi-wall route is safe', () => {
    const obstacles = [
        wall,
        { id: 'crate', minXMeters: -2, maxXMeters: 1, minYMeters: 2.5, maxYMeters: 4 },
    ];
    let zombie: ZombieState = { ...initialZombie, targetPlayerId: 'player' };
    for (let tick = 0; tick < 450; tick++) {
        const next = step(zombie, [player(3)], obstacles);
        const resolved = resolveMovement(zombie.position, next.position, obstacles);
        expect(resolved.xMeters).toBeCloseTo(next.position.xMeters, 10);
        expect(resolved.yMeters).toBeCloseTo(next.position.yMeters, 10);
        zombie = next;
    }
    expect(Math.hypot(zombie.position.xMeters - 3, zombie.position.yMeters)).toBeCloseTo(
        zombieSettings.stopRangeMeters,
        8,
    );
});
