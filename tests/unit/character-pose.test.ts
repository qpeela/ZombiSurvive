import type { WorldPosition } from '@zombi-survive/domain';
import { expect, test } from 'vitest';

import {
    CharacterMotion,
    interpolateCharacterPosition,
} from '../../apps/client/src/character-pose.ts';

const origin = { xMeters: 0, yMeters: 0 };
const sample = (motion: CharacterMotion, position: WorldPosition, deltaMs = 20) =>
    motion.sample({ position, deltaMs, isSneaking: false, isZombie: false });

const walk = (frames: number) => {
    const motion = new CharacterMotion('player');
    sample(motion, origin);
    let pose = sample(motion, origin);
    for (let frame = 1; frame <= frames; frame++) {
        pose = sample(motion, { xMeters: (4.4 * frame) / frames, yMeters: 0 }, 1100 / frames);
    }
    return { motion, pose };
};

test('the same travelled distance gives the same walking pose at different frame rates', () => {
    const slower = walk(30).pose;
    const faster = walk(120).pose;
    expect(slower.mode).toBe('walk');
    expect(faster.mode).toBe('walk');
    expect(slower.phase).toBeCloseTo(faster.phase, 8);
    expect(slower.leftStep).toBeCloseTo(faster.leftStep, 8);
    expect(slower.leftStep).toBeGreaterThan(2);
    expect(slower.rightStep).toBeCloseTo(-slower.leftStep, 8);
});

test('stopping settles both feet and retains direction; idle breathing continues without steps', () => {
    const { motion } = walk(60);
    const position = { xMeters: 4.4, yMeters: 0 };
    let pose = sample(motion, position);
    for (let frame = 0; frame < 60; frame++) pose = sample(motion, position);
    expect(pose.mode).toBe('idle');
    expect(pose.leftStep).toBeCloseTo(0, 4);
    expect(pose.rightStep).toBeCloseTo(0, 4);
    expect(pose.heading).toBe(0);
    const breath = pose.breath;
    expect(sample(motion, position, 200).breath).not.toBe(breath);
    expect(sample(motion, position).phase).toBe(pose.phase);
});

test('sprint, crouching and the zombie dragging foot have distinct motion', () => {
    const run = new CharacterMotion('runner');
    const sneak = new CharacterMotion('sneaker');
    const zombie = new CharacterMotion('zombie');
    for (const motion of [run, sneak, zombie]) sample(motion, origin);
    let running = sample(run, origin);
    let sneaking = sample(sneak, origin);
    let shuffling = sample(zombie, origin);
    for (let frame = 1; frame <= 20; frame++) {
        running = sample(run, { xMeters: frame * 0.14, yMeters: 0 });
        sneaking = sneak.sample({
            position: { xMeters: 0, yMeters: frame * 0.04 },
            deltaMs: 20,
            isSneaking: true,
            isZombie: false,
        });
        shuffling = zombie.sample({
            position: { xMeters: 0, yMeters: frame * 0.03 },
            deltaMs: 20,
            isSneaking: false,
            isZombie: true,
        });
    }
    expect(running.mode).toBe('run');
    expect(sneaking.mode).toBe('sneak');
    expect(shuffling.mode).toBe('shuffle');
    expect(Math.abs(shuffling.leftStep)).toBeGreaterThan(Math.abs(shuffling.rightStep));
    expect(shuffling.heading).toBeCloseTo(Math.PI / 2);
});

test('a blocked actor, first appearance, teleport and reset never produce phantom footsteps', () => {
    const motion = new CharacterMotion('player');
    expect(sample(motion, { xMeters: 900, yMeters: -900 }).mode).toBe('idle');
    for (let frame = 0; frame < 30; frame++) {
        expect(sample(motion, { xMeters: 900, yMeters: -900 }).leftStep).toBe(0);
    }
    const target = { xMeters: -900, yMeters: 900 };
    expect(sample(motion, target).mode).toBe('idle');
    expect(sample(motion, { ...target, xMeters: -899.9 }).mode).toBe('walk');
    motion.reset();
    const respawn = sample(motion, origin);
    expect(respawn.mode).toBe('idle');
    expect(respawn.phase).toBe(0);
    expect(respawn.leftStep).toBe(0);
});

test.each([0, -10, 2000, Number.NaN])(
    'frame interruption %s resets gait without nonfinite geometry',
    deltaMs => {
        const { motion } = walk(30);
        const pose = sample(motion, { xMeters: 20, yMeters: 0 }, deltaMs);
        expect(pose.mode).toBe('idle');
        expect(pose.leftStep).toBe(0);
        expect(
            Object.values(pose)
                .filter(value => typeof value === 'number')
                .every(Number.isFinite),
        ).toBe(true);
    },
);

test('remote render smoothing is frame-rate independent and never changes snapshots', () => {
    const current = { xMeters: 0, yMeters: 0 };
    const target = { xMeters: 2, yMeters: -1 };
    const whole = interpolateCharacterPosition({ current, target, deltaMs: 100 });
    let split = current;
    for (let frame = 0; frame < 10; frame++) {
        split = interpolateCharacterPosition({ current: split, target, deltaMs: 10 });
    }
    expect(split.xMeters).toBeCloseTo(whole.xMeters, 8);
    expect(split.yMeters).toBeCloseTo(whole.yMeters, 8);
    expect(whole.xMeters).toBeGreaterThan(0);
    expect(whole.xMeters).toBeLessThan(target.xMeters);
    expect(current).toEqual(origin);
    expect(target).toEqual({ xMeters: 2, yMeters: -1 });
});

test('remote first relocation and resumed background tab snap instead of sweeping through the map', () => {
    const target = { xMeters: 20, yMeters: -12 };
    expect(interpolateCharacterPosition({ current: origin, target, deltaMs: 16 })).toEqual(target);
    expect(
        interpolateCharacterPosition({
            current: origin,
            target: { xMeters: 1, yMeters: 0 },
            deltaMs: 1000,
        }),
    ).toEqual({ xMeters: 1, yMeters: 0 });
    expect(
        interpolateCharacterPosition({
            current: origin,
            target: { xMeters: 0.0001, yMeters: 0 },
            deltaMs: 16,
        }),
    ).toEqual({ xMeters: 0.0001, yMeters: 0 });
});
