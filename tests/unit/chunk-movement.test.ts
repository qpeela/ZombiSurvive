import { collisionSettings } from '@zombi-survive/content';
import type { WorldPosition } from '@zombi-survive/domain';
import { expect, test } from 'vitest';

import {
    createMovementInput,
    createMovementTarget,
} from '../../apps/client/src/movement-contract.ts';
import { MovementPrediction } from '../../apps/client/src/movement-prediction.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';

const travel = (movement: LocalWorldMovement, sessionId = 'session') => {
    let sequence = 0;

    return (target: WorldPosition): void => {
        for (let tick = 0; tick < 2500; tick++) {
            movement.receive(sessionId, createMovementTarget(++sequence, target));
            movement.step();
            const position = movement.snapshot(sessionId).player.position;

            if (
                Math.hypot(position.xMeters - target.xMeters, position.yMeters - target.yMeters) <
                1e-8
            ) {
                return;
            }
        }

        throw new Error(`Could not reach ${JSON.stringify(target)}`);
    };
};

test.each([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [-2, -1],
])(
    'authority crosses signed seams and agrees with prediction on a wall in chunk (%s, %s)',
    (chunkX, chunkY) => {
        const movement = new LocalWorldMovement('world', 'player');
        movement.join('session');
        const arrive = travel(movement);
        const x = chunkX * 64;
        const y = chunkY * 64;
        arrive({ xMeters: 0, yMeters: -10 });
        arrive({ xMeters: x - 10, yMeters: -10 });
        arrive({ xMeters: x - 10, yMeters: y });
        arrive({ xMeters: x + 4.4, yMeters: y });
        const snapshot = movement.snapshot('session');
        const prediction = new MovementPrediction();
        prediction.accept(snapshot, 0);
        prediction.setIntent(
            { type: 'direction', direction: { x: 1, y: 0 }, isSprinting: false, isSneaking: false },
            0,
        );
        prediction.recordSent(createMovementInput(100_000, { x: 1, y: 0 }), 0);
        movement.receive('session', createMovementTarget(100_000, { xMeters: x + 10, yMeters: y }));

        for (let tick = 0; tick < 9; tick++) movement.step();

        const boundary = x + 5 - collisionSettings.playerHalfSizeMeters;
        expect(movement.snapshot('session').player.position.xMeters).toBeCloseTo(boundary, 8);
        expect(prediction.sample(450)?.position.xMeters).toBeCloseTo(boundary, 8);
        prediction.reset();
        prediction.accept(snapshot, 1000);
        prediction.setIntent(
            {
                type: 'target',
                target: { xMeters: x + 10, yMeters: y },
                isSprinting: false,
                isSneaking: false,
            },
            1000,
        );
        expect(prediction.sample(1450)?.position.xMeters).toBeCloseTo(boundary, 8);
    },
);

test('distant players retain independent colliders and returning to unloaded regions reproduces them', () => {
    const movement = new LocalWorldMovement('world', 'first');
    movement.join('first-session');
    movement.join('second-session', 'second');
    const first = travel(movement, 'first-session');
    const second = travel(movement, 'second-session');
    first({ xMeters: 0, yMeters: -10 });
    first({ xMeters: 256, yMeters: -10 });
    second({ xMeters: 2, yMeters: -10 });
    second({ xMeters: -256, yMeters: -10 });
    second({ xMeters: -256, yMeters: 0 });
    second({ xMeters: -251.6, yMeters: 0 });
    movement.receive('second-session', createMovementInput(100_000, { x: 1, y: 0 }));
    for (let tick = 0; tick < 9; tick++) movement.step();
    expect(movement.snapshot('second-session').player.position.xMeters).toBeCloseTo(-251.35, 8);
    first({ xMeters: 0, yMeters: -10 });
    first({ xMeters: 0, yMeters: 0 });
    first({ xMeters: 4.4, yMeters: 0 });
    movement.receive('first-session', createMovementInput(100_000, { x: 1, y: 0 }));
    for (let tick = 0; tick < 9; tick++) movement.step();
    expect(movement.snapshot('first-session').player.position.xMeters).toBeCloseTo(4.65, 8);
});
