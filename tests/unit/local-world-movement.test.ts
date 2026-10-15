import type { MovementDirection } from '@zombi-survive/domain';
import { expect, test } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';

const command = (sequence: number, direction: MovementDirection = { x: 1, y: 0 }) => ({
    type: 'movement-input',
    protocolVersion: 2,
    sequence,
    direction,
});
const setup = (): LocalWorldMovement => {
    const movement = new LocalWorldMovement('world', 'player');
    movement.join('first');
    movement.join('second');

    return movement;
};

test('a flood is coalesced and cannot advance position or ack outside a fixed step', () => {
    const movement = setup();

    for (let sequence = 1; sequence <= 1000; sequence++) {
        movement.receive('first', command(sequence));
    }

    expect(movement.snapshot('first')).toMatchObject({
        tick: 0,
        player: { position: { xMeters: 0, yMeters: 0 } },
        lastProcessedInputSequence: null,
    });
    movement.step();
    expect(movement.snapshot('first')).toMatchObject({
        tick: 1,
        player: { position: { xMeters: 0.2, yMeters: 0 } },
        lastProcessedInputSequence: 1000,
    });
    expect(movement.snapshot('second').lastProcessedInputSequence).toBeNull();
});

test('twenty steps with fresh intentions move four meters, with equal diagonal speed', () => {
    for (const direction of [
        { x: 1, y: 0 },
        { x: -1, y: -1 },
    ] as const) {
        const movement = setup();

        for (let tick = 1; tick <= 20; tick++) {
            if (tick % 2 === 1) {
                movement.receive('first', command(tick, direction));
            }

            movement.step();
        }

        const { xMeters, yMeters } = movement.snapshot('first').player.position;
        expect(Math.hypot(xMeters, yMeters)).toBeCloseTo(4, 12);
        expect(Math.sign(xMeters)).toBe(direction.x);
        expect(Math.sign(yMeters)).toBe(direction.y);
    }
});

test('duplicate, old, malformed, incompatible and unknown-session inputs cannot replace a stop', () => {
    const movement = setup();
    movement.receive('first', command(2, { x: 0, y: 0 }));
    movement.receive('first', command(2));
    movement.receive('first', command(1));
    movement.receive('first', { ...command(3), protocolVersion: 3 });
    movement.receive('first', { ...command(3), direction: { x: 100, y: 0 } });
    movement.receive('first', null);
    movement.receive('unknown', command(3));
    movement.step();

    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 0, yMeters: 0 });
    expect(movement.snapshot('first').lastProcessedInputSequence).toBe(2);
});

test('stop takes effect on the next step and no later tick moves the player', () => {
    const movement = setup();
    movement.receive('first', command(1));
    movement.step();
    movement.receive('first', command(2, { x: 0, y: 0 }));
    expect(movement.snapshot('first').lastProcessedInputSequence).toBe(1);

    for (let tick = 0; tick < 20; tick++) {
        movement.step();
    }

    expect(movement.snapshot('first').player.position.xMeters).toBe(0.2);
    expect(movement.snapshot('first').lastProcessedInputSequence).toBe(2);
});

test('input expires after ten moving steps, and duplicate heartbeats cannot renew it', () => {
    const movement = setup();
    movement.receive('first', command(1));

    for (let tick = 0; tick < 20; tick++) {
        movement.receive('first', command(1));
        movement.step();
    }

    expect(movement.snapshot('first').player.position.xMeters).toBeCloseTo(2, 12);
});

test('latest nonzero tab controls the solo player; an unrelated stop cannot cancel it', () => {
    const movement = setup();
    movement.receive('first', command(1));
    movement.receive('second', command(1, { x: 0, y: -1 }));
    movement.step();
    movement.receive('first', command(2, { x: 0, y: 0 }));
    movement.step();

    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 0, yMeters: -0.4 });
    expect(movement.snapshot('second').lastProcessedInputSequence).toBe(1);

    movement.receive('second', command(2, { x: 0, y: 0 }));
    movement.step();
    expect(movement.snapshot('first').player.position.yMeters).toBe(-0.4);
});

test('latest pending input preserves receipt order across tabs, not their join order', () => {
    const movement = setup();
    movement.receive('first', command(1));
    movement.receive('second', command(1, { x: -1, y: 0 }));
    movement.receive('first', command(2, { x: 0, y: 1 }));
    movement.step();

    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 0, yMeters: 0.2 });
});

test('disconnect cancels pending input and movement even while another tab remains joined', () => {
    const movement = setup();
    movement.receive('first', command(1));
    movement.step();
    movement.receive('first', command(2, { x: -1, y: 0 }));
    movement.leave('first');
    movement.step();
    expect(movement.snapshot('second').player.position.xMeters).toBe(0.2);
    movement.join('replacement');
    expect(movement.snapshot('replacement').lastProcessedInputSequence).toBeNull();
    movement.receive('replacement', command(1, { x: 0, y: 1 }));
    movement.step();

    expect(movement.snapshot('replacement')).toMatchObject({
        worldId: 'world',
        player: { playerId: 'player', position: { xMeters: 0.2, yMeters: 0.2 } },
        lastProcessedInputSequence: 1,
    });
});

test('participants move independently and cannot select another character through a command', () => {
    const movement = new LocalWorldMovement('world', 'host');
    movement.join('host-tab', 'host');
    movement.join('friend-tab', 'friend');
    movement.receive('host-tab', { ...command(1), playerId: 'friend' });
    movement.receive('friend-tab', command(1, { x: 0, y: -1 }));
    movement.step();
    expect(movement.snapshot('host-tab')).toMatchObject({
        tick: 1,
        player: { playerId: 'host', position: { xMeters: 0.2, yMeters: 0 } },
        otherPlayers: [{ playerId: 'friend', position: { xMeters: 2, yMeters: -0.2 } }],
        lastProcessedInputSequence: 1,
    });
    expect(movement.snapshot('friend-tab').otherPlayers).toEqual([
        movement.snapshot('host-tab').player,
    ]);
    movement.leave('host-tab');
    movement.step();
    expect(movement.snapshot('friend-tab').player.position.yMeters).toBe(-0.4);
    expect(movement.snapshot('friend-tab').otherPlayers[0]?.position.xMeters).toBe(0.2);
    movement.join('host-reload', 'host');
    expect(movement.snapshot('host-reload').player.position.xMeters).toBe(0.2);
    expect(movement.snapshot('host-reload').lastProcessedInputSequence).toBeNull();
});

test('same-player tabs share control without cancelling another participant or leaking snapshots', () => {
    const movement = new LocalWorldMovement('world', 'host');
    movement.join('first', 'host');
    movement.join('second', 'host');
    movement.join('friend', 'friend');
    movement.receive('second', command(1));
    movement.receive('friend', command(1, { x: 0, y: 1 }));
    movement.receive('first', command(1, { x: 0, y: 0 }));
    movement.step();
    const detached = movement.snapshot('first');
    expect(detached.player.position.xMeters).toBe(0.2);
    expect(detached.otherPlayers[0]?.position.yMeters).toBe(0.2);
    movement.step();
    expect(detached.otherPlayers[0]?.position.yMeters).toBe(0.2);
    expect(movement.snapshot('friend').player.position.yMeters).toBe(0.4);
});
