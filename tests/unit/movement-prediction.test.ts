import type { MovementSnapshot } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

import {
    createMovementInput,
    createMovementTarget,
} from '../../apps/client/src/movement-contract.ts';
import { MovementPrediction } from '../../apps/client/src/movement-prediction.ts';

const snapshot = (tick: number, xMeters = 0, ack: number | null = null): MovementSnapshot => ({
    type: 'movement-snapshot',
    protocolVersion: 4,
    worldId: 'world',
    tick,
    player: {
        playerId: 'player',
        stamina: 1,
        isExhausted: false,
        position: { xMeters, yMeters: 0 },
    },
    lastProcessedInputSequence: ack,
    otherPlayers: [],
});
const right = { type: 'direction', isSprinting: false, direction: { x: 1, y: 0 } } as const;
const stop = { type: 'direction', isSprinting: false, direction: { x: 0, y: 0 } } as const;

test('local input moves before a packet or acknowledgement, at the shared speed', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1), 0);
    prediction.setIntent(right, 0);
    expect(prediction.sample(25)?.position.xMeters).toBeCloseTo(0.1, 12);
    expect(prediction.sample(100)?.position.xMeters).toBeCloseTo(0.4, 12);
    prediction.setIntent({ type: 'direction', isSprinting: false, direction: { x: 1, y: 1 } }, 100);
    const position = prediction.sample(200)?.position;
    expect(position?.xMeters).toBeCloseTo(0.4 + 0.4 / Math.SQRT2, 12);
    expect(position?.yMeters).toBeCloseTo(0.4 / Math.SQRT2, 12);
});

test('old snapshots replay unacknowledged held input without counting packets as steps', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1), 0);
    prediction.setIntent(right, 0);
    prediction.recordSent(createMovementInput(1, right.direction), 0);
    prediction.recordSent(createMovementInput(2, right.direction), 100);
    prediction.accept(snapshot(2), 200);
    expect(prediction.sample(200)?.position.xMeters).toBeCloseTo(0.8, 12);
    prediction.accept(snapshot(3, 0.2, 1), 250);
    // The second, unacked heartbeat is 150 ms old; only that window is replayed.
    expect(prediction.sample(250)?.position.xMeters).toBeCloseTo(0.8, 12);
    prediction.setIntent(stop, 250);
    prediction.recordSent(createMovementInput(3, stop.direction), 300);
    prediction.accept(snapshot(8, 0.9, 3), 400);
    expect(prediction.sample(450)?.position.xMeters).toBe(0.9);
    expect(prediction.sample(1000)?.position.xMeters).toBe(0.9);
});

test('corrections always rebase on authority and a superseding ack removes coalesced inputs', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1), 0);
    prediction.setIntent(right, 0);
    prediction.recordSent(createMovementInput(1, right.direction), 0);
    prediction.setIntent({ type: 'direction', isSprinting: false, direction: { x: -1, y: 0 } }, 50);
    prediction.recordSent(createMovementInput(2, { x: -1, y: 0 }), 100);
    prediction.recordSent(createMovementInput(3, stop.direction), 200);
    prediction.accept(snapshot(9, -2, 3), 250);
    expect(prediction.sample(300)?.position.xMeters).toBe(-2);
    prediction.accept(snapshot(8, 99, 1), 350);
    expect(prediction.sample(400)?.position.xMeters).toBe(-2);
});

test('predicted targets stop precisely and cannot cross the same wall as the server', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1, 4), 0);
    const target = { xMeters: 8, yMeters: 0 };
    prediction.setIntent({ type: 'target', isSprinting: false, target }, 0);
    prediction.recordSent(createMovementTarget(1, target), 0);
    expect(prediction.sample(500)?.position.xMeters).toBe(4.65);
    prediction.setIntent({ type: 'direction', isSprinting: false, direction: { x: 1, y: 1 } }, 100);
    const slid = prediction.sample(500)?.position;
    expect(slid?.xMeters).toBe(4.65);
    expect(slid?.yMeters).toBeGreaterThan(1);
    prediction.reset();
    prediction.accept(snapshot(2), 1000);
    prediction.setIntent(
        { type: 'target', isSprinting: false, target: { xMeters: 0.3, yMeters: 0 } },
        1000,
    );
    expect(prediction.sample(1500)?.position.xMeters).toBe(0.3);
});

test('lost snapshots freeze after half a second, including during a long frame pause', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1), 0);
    prediction.setIntent(right, 0);
    prediction.recordSent(createMovementInput(1, right.direction), 0);
    expect(prediction.sample(500)?.position.xMeters).toBeCloseTo(2, 12);
    expect(prediction.sample(60000)).toEqual(prediction.sample(500));
    prediction.accept(snapshot(100, 1, 1), 60000);
    expect(prediction.sample(60001)?.position.xMeters).toBe(1);
});

test('reset, new identities and history overflow discard old predictions', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1), 0);
    prediction.setIntent(right, 0);
    prediction.recordSent(createMovementInput(1, right.direction), 0);
    prediction.reset();
    expect(prediction.sample(100)).toBeNull();
    prediction.accept(snapshot(20, -1), 100);
    expect(prediction.sample(200)?.position.xMeters).toBe(-1);
    prediction.setIntent(right, 200);
    prediction.accept({ ...snapshot(0), worldId: 'replacement' }, 300);
    expect(prediction.sample(400)?.position.xMeters).toBe(0);

    for (let sequence = 1; sequence <= 65; sequence++) {
        prediction.recordSent(createMovementInput(sequence, right.direction), 400 + sequence);
    }

    expect(prediction.sample(1000)?.position.xMeters).toBe(0);
    prediction.accept(snapshot(1, 2, 65), 1000);
    expect(prediction.sample(1100)?.position.xMeters).toBe(2);
});

test('a moving correction replays only pending intent and sampling cannot accumulate distance', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1), 0);
    prediction.setIntent(right, 0);
    prediction.recordSent(createMovementInput(1, right.direction), 0);
    prediction.setIntent(
        { type: 'direction', isSprinting: false, direction: { x: 0, y: -1 } },
        100,
    );
    prediction.recordSent(createMovementInput(2, { x: 0, y: -1 }), 100);
    prediction.accept(snapshot(2, -2, 1), 200);
    const current = prediction.sample(200);
    expect(current?.position.xMeters).toBe(-2);
    expect(current?.position.yMeters).toBeCloseTo(-0.4, 12);

    for (let frame = 0; frame < 100; frame++) {
        expect(prediction.sample(200)).toEqual(current);
    }

    prediction.accept(snapshot(3, -3, 1), 250);
    expect(prediction.sample(250)?.position.xMeters).toBe(-3);
    expect(prediction.sample(250)?.position.yMeters).toBeCloseTo(-0.6, 12);
});

test('sprint prediction responds before send and rebases stamina and exhaustion on authority', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1), 0);
    prediction.setIntent({ ...right, isSprinting: true }, 0);
    expect(prediction.sample(25)?.position.xMeters).toBeCloseTo(0.175, 12);
    expect(prediction.sample(25)?.stamina).toBeCloseTo(0.995, 12);
    prediction.recordSent(createMovementInput(1, right.direction, true), 100);
    const authority = {
        ...snapshot(3, 0.4, 1),
        player: {
            ...snapshot(3).player,
            position: { xMeters: 0.4, yMeters: 0 },
            stamina: 0,
            isExhausted: true,
        },
    };
    prediction.accept(authority, 100);
    expect(prediction.sample(200)?.position.xMeters).toBeCloseTo(0.8, 12);
    expect(prediction.sample(200)?.stamina).toBeCloseTo(0.01, 12);
    expect(prediction.sample(200)?.isExhausted).toBe(true);
    prediction.reset();
    expect(prediction.sample(200)).toBeNull();
});

test('releasing Shift at unchanged direction is a distinct prediction intent and ack', () => {
    const prediction = new MovementPrediction();
    prediction.accept(snapshot(1), 0);
    prediction.setIntent({ ...right, isSprinting: true }, 0);
    prediction.setIntent(right, 100);
    expect(prediction.sample(200)?.position.xMeters).toBeCloseTo(1.1, 12);
    expect(prediction.sample(200)?.stamina).toBeCloseTo(0.99, 12);
});
