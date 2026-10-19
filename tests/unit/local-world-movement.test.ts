import type { MovementDirection } from '@zombi-survive/domain';
import { expect, test } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';

const command = (sequence: number, direction: MovementDirection = { x: 1, y: 0 }) => ({
    type: 'movement-input',
    protocolVersion: 5,
    sequence,
    isSprinting: false,
    isSneaking: false,
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
    movement.receive('first', { ...command(3), protocolVersion: 4 });
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
        player: {
            playerId: 'player',
            stamina: 1,
            isExhausted: false,
            position: { xMeters: 0.2, yMeters: 0.2 },
        },
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
        player: {
            playerId: 'host',
            stamina: 1,
            isExhausted: false,
            position: { xMeters: 0.2, yMeters: 0 },
        },
        otherPlayers: [
            {
                playerId: 'friend',
                stamina: 1,
                isExhausted: false,
                position: { xMeters: 2, yMeters: -0.2 },
            },
        ],
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

const targetCommand = (sequence: number, xMeters: number, yMeters: number) => ({
    type: 'movement-target',
    protocolVersion: 5,
    sequence,
    isSprinting: false,
    isSneaking: false,
    target: { xMeters, yMeters },
});

test('mouse commands move at fixed speed, acknowledge on step and stop exactly at target', () => {
    const movement = setup();
    const target = targetCommand(1, 0.3, -0.4);
    movement.receive('first', target);
    target.target.xMeters = 999;
    expect(movement.snapshot('first').player.position.xMeters).toBe(0);
    movement.step();
    const first = movement.snapshot('first');
    expect(Math.hypot(first.player.position.xMeters, first.player.position.yMeters)).toBeCloseTo(
        0.2,
        12,
    );
    expect(first.lastProcessedInputSequence).toBe(1);
    movement.step();
    movement.step();
    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 0.3, yMeters: -0.4 });
    movement.step();
    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 0.3, yMeters: -0.4 });
});

test('new targets and keyboard commands share ordering; unrelated tabs cannot cancel a target', () => {
    const movement = setup();
    movement.receive('first', targetCommand(1, 100, 0));
    movement.receive('first', targetCommand(2, 0, -100));
    movement.receive('second', command(1, { x: 0, y: 0 }));
    movement.step();
    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 0, yMeters: -0.2 });
    movement.receive('first', command(3, { x: 1, y: 0 }));
    movement.receive('first', targetCommand(2, -100, 0));
    movement.step();
    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 0.2, yMeters: -0.2 });
    movement.receive('first', command(4, { x: 0, y: 0 }));
    movement.step();
    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 0.2, yMeters: -0.2 });
});

test('target heartbeats expire and disconnect cancels a destination', () => {
    const movement = setup();
    movement.receive('first', targetCommand(1, 100, 0));
    for (let tick = 0; tick < 20; tick++) {
        movement.receive('first', targetCommand(1, 100, 0));
        movement.step();
    }
    expect(movement.snapshot('first').player.position.xMeters).toBeCloseTo(2, 12);
    movement.receive('first', targetCommand(2, 100, 0));
    movement.step();
    movement.leave('first');
    movement.step();
    expect(movement.snapshot('second').player.position.xMeters).toBeCloseTo(2.2, 12);
});

test('a flood of target commands cannot teleport or move another participant', () => {
    const movement = new LocalWorldMovement('world', 'host');
    movement.join('host-tab', 'host');
    movement.join('friend-tab', 'friend');
    for (let sequence = 1; sequence <= 1000; sequence++) {
        movement.receive('host-tab', {
            ...targetCommand(sequence, 1000, 0),
            playerId: 'friend',
            stamina: 1,
            isExhausted: false,
            position: { xMeters: 999, yMeters: 999 },
        });
    }
    movement.receive('unknown', targetCommand(1001, -1000, 0));
    movement.step();
    expect(movement.snapshot('host-tab')).toMatchObject({
        player: {
            playerId: 'host',
            stamina: 1,
            isExhausted: false,
            position: { xMeters: 0.2, yMeters: 0 },
        },
        otherPlayers: [
            {
                playerId: 'friend',
                stamina: 1,
                isExhausted: false,
                position: { xMeters: 2, yMeters: 0 },
            },
        ],
        lastProcessedInputSequence: 1000,
    });
});

test.each(['keyboard', 'target', 'inside-target'] as const)(
    '%s cannot move through a wall, even with forged positions',
    kind => {
        const movement = setup();

        for (let sequence = 1; sequence <= 100; sequence++) {
            const targetX = kind === 'inside-target' ? 5.25 : 1000;
            const input =
                kind === 'keyboard' ? command(sequence) : targetCommand(sequence, targetX, 0);
            movement.receive('first', { ...input, position: { xMeters: 1000, yMeters: 0 } });
            movement.step();
            expect(movement.snapshot('first').player.position.xMeters).toBeLessThanOrEqual(4.65);
        }

        expect(movement.snapshot('first')).toMatchObject({
            player: { position: { xMeters: 4.65, yMeters: 0 } },
            lastProcessedInputSequence: 100,
        });
        movement.leave('first');
        movement.join('replacement');
        expect(movement.snapshot('replacement').player.position).toEqual({
            xMeters: 4.65,
            yMeters: 0,
        });
        expect(movement.snapshot('replacement').lastProcessedInputSequence).toBeNull();
    },
);

test('keyboard slides along a wall; new targets can lead around its end', () => {
    const movement = setup();
    let sequence = 0;
    const walkTo = (x: number, y: number, ticks: number): void => {
        for (let tick = 0; tick < ticks; tick++) {
            movement.receive('first', targetCommand(++sequence, x, y));
            movement.step();
        }
    };
    walkTo(10, 0, 50);
    for (let tick = 0; tick < 10; tick++) {
        movement.receive('first', command(++sequence, { x: 1, y: 1 }));
        movement.step();
    }

    expect(movement.snapshot('first').player.position.xMeters).toBe(4.65);
    expect(movement.snapshot('first').player.position.yMeters).toBeCloseTo(Math.SQRT2, 12);
    walkTo(4, 4, 30);
    walkTo(7, 4, 30);
    expect(movement.snapshot('first').player.position).toEqual({ xMeters: 7, yMeters: 4 });
});

test('sprint cannot forge stamina or speed and disconnected controllers recover without moving', () => {
    const movement = setup();
    movement.receive('first', {
        ...command(1, { x: 0, y: -1 }),
        isSprinting: true,
        stamina: 999,
        speed: 999,
    });
    movement.step();
    expect(movement.snapshot('first').player.position.yMeters).toBeCloseTo(-0.35, 12);
    expect(movement.snapshot('first').player.stamina).toBeCloseTo(0.99, 12);
    movement.leave('first');
    movement.step();
    const stopped = movement.snapshot('second').player;
    expect(stopped.position.yMeters).toBeCloseTo(-0.35, 12);
    expect(stopped.stamina).toBeCloseTo(0.995, 12);
    movement.join('reloaded');
    expect(movement.snapshot('reloaded').player).toEqual(stopped);
});

test('mouse sprint respects walls and expired sprint stops draining stamina', () => {
    const movement = setup();
    movement.receive('first', { ...targetCommand(1, 100, 0), isSprinting: true });
    for (let tick = 0; tick < 10; tick++) movement.step();
    expect(movement.snapshot('first').player.stamina).toBeCloseTo(0.9, 12);
    movement.step();
    expect(movement.snapshot('first').player.stamina).toBeCloseTo(0.905, 12);
    for (let tick = 2; tick < 30; tick++) {
        movement.receive('first', { ...targetCommand(tick, 100, 0), isSprinting: true });
        movement.step();
    }
    expect(movement.snapshot('first').player.position.xMeters).toBe(4.65);
    expect(movement.snapshot('first').player.stamina).toBeLessThan(0.9);
});

test('authoritative sprint depletes, walks through recovery and resumes for independent players', () => {
    const movement = new LocalWorldMovement('world', 'host');
    movement.join('host');
    movement.join('friend', 'friend');
    for (let tick = 1; tick <= 100; tick++) {
        movement.receive('host', { ...command(tick, { x: 0, y: -1 }), isSprinting: true });
        movement.step();
    }
    expect(movement.snapshot('host').player).toMatchObject({ stamina: 0, isExhausted: true });
    expect(movement.snapshot('friend').player.stamina).toBe(1);
    const startY = movement.snapshot('host').player.position.yMeters;
    for (let tick = 101; tick <= 140; tick++) {
        movement.receive('host', { ...command(tick, { x: 0, y: -1 }), isSprinting: true });
        movement.step();
    }
    const recovered = movement.snapshot('host').player;
    expect(recovered.position.yMeters - startY).toBeCloseTo(-8, 12);
    expect(recovered.isExhausted).toBe(false);
    movement.step();
    expect(
        movement.snapshot('host').player.position.yMeters - recovered.position.yMeters,
    ).toBeCloseTo(-0.35, 12);
});

test('stealth is authoritative, overrides sprint, and clears on expiry and disconnect', () => {
    const movement = setup();
    movement.receive('first', {
        ...command(1, { x: 0, y: -1 }),
        isSneaking: true,
        isSprinting: true,
        noiseRadiusMeters: 999,
        speed: 999,
    });
    movement.step();
    expect(movement.snapshot('first').player).toMatchObject({
        position: { xMeters: 0, yMeters: -0.1 },
        isSneaking: true,
        noiseRadiusMeters: 2,
        stamina: 1,
    });
    for (let tick = 0; tick < 10; tick++) movement.step();
    expect(movement.snapshot('first').player).toMatchObject({
        isSneaking: false,
        noiseRadiusMeters: 0,
    });
    movement.receive('first', { ...targetCommand(2, 0, -2), isSneaking: true });
    movement.step();
    expect(movement.snapshot('first').player.isSneaking).toBe(true);
    movement.leave('first');
    movement.step();
    expect(movement.snapshot('second').player).toMatchObject({
        isSneaking: false,
        noiseRadiusMeters: 0,
    });
});

test('idle stealth stays owned, follows the latest tab and cannot be stopped by an inactive tab', () => {
    const movement = setup();
    movement.receive('first', { ...command(1, { x: 0, y: 0 }), isSneaking: true });
    movement.step();
    expect(movement.snapshot('second').player).toMatchObject({
        isSneaking: true,
        noiseRadiusMeters: 0,
    });
    movement.receive('second', command(1, { x: 0, y: 0 }));
    movement.step();
    expect(movement.snapshot('first').player.isSneaking).toBe(true);
    movement.receive('first', command(2, { x: 0, y: 0 }));
    movement.step();
    expect(movement.snapshot('first').player.isSneaking).toBe(false);
});

test('a sneaking character stopped by a wall is silent and cannot cross it', () => {
    const movement = setup();
    for (let tick = 1; tick <= 70; tick++) {
        movement.receive('first', { ...command(tick), isSneaking: true });
        movement.step();
    }
    const player = movement.snapshot('first').player;
    expect(player.position.xMeters).toBeCloseTo(4.65, 8);
    expect(player).toMatchObject({ isSneaking: true, noiseRadiusMeters: 0, stamina: 1 });
});
