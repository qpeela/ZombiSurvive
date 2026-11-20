import { hungerSettings, thirstSettings } from '@zombi-survive/content';
import type { PlayerMovementState } from '@zombi-survive/domain';
import { isMovementSnapshot, protocolVersion } from '@zombi-survive/protocol';
import {
    movementStepSeconds,
    sprintDrainMultiplier,
    staminaEffectsFromNeeds,
    stepPlayerMovement,
    stepPlayerToward,
} from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

import { readMovementSnapshot } from '../../apps/client/src/movement-contract.ts';
import { MovementPrediction } from '../../apps/client/src/movement-prediction.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import {
    createMovementSnapshot,
    readMovementInput,
} from '../../apps/server/src/movement-contract.ts';

const player = (weightGrams: number): PlayerMovementState => ({
    playerId: 'solo',
    position: { xMeters: 0, yMeters: 0 },
    stamina: 1,
    isExhausted: false,
    isSneaking: false,
    noiseRadiusMeters: 0,
    carriedWeightGrams: weightGrams,
});
const modifiers = { isSprinting: true, isSneaking: false };

test('the same seven-metre route spends twice the stamina at two kilograms, for WASD and clicks', () => {
    for (const isTarget of [false, true]) {
        const states = [player(0), player(2000)].map(initial => {
            let state = initial;
            for (let tick = 0; tick < 20; tick++) {
                state = isTarget
                    ? stepPlayerToward(
                          state,
                          { xMeters: 0, yMeters: -7 },
                          movementStepSeconds,
                          modifiers,
                      )
                    : stepPlayerMovement(state, { x: 0, y: -1 }, movementStepSeconds, modifiers);
            }
            return state;
        });
        for (const state of states) expect(state.position.yMeters).toBeCloseTo(-7, 12);
        expect(states[0]?.stamina).toBeCloseTo(0.8, 12);
        expect(states[1]?.stamina).toBeCloseTo(0.6, 12);
    }
});

test('load leaves walking, idle recovery and the priority of stealth unchanged', () => {
    const initial = { ...player(4000), stamina: 0.5 };
    for (const direction of [
        { x: 0, y: 0 },
        { x: 0, y: -1 },
    ] as const) {
        expect(stepPlayerMovement(initial, direction, movementStepSeconds).stamina).toBeCloseTo(
            0.505,
            12,
        );
    }
    const sneaking = stepPlayerMovement(initial, { x: 0, y: -1 }, movementStepSeconds, {
        isSprinting: true,
        isSneaking: true,
    });
    expect(sneaking.stamina).toBeCloseTo(0.505, 12);
    expect(sneaking.position.yMeters).toBe(-0.1);
    expect(sprintDrainMultiplier(1900)).toBe(1.95);
    expect(sprintDrainMultiplier(20_000)).toBe(3);
});

test('server weight wins over spoofed input and duplicate tabs do not double stamina use', () => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    movement.join('second');
    for (let sequence = 1; sequence <= 20; sequence++) {
        movement.receive('first', {
            type: 'movement-input',
            protocolVersion,
            sequence,
            direction: { x: 0, y: -1 },
            ...modifiers,
            carriedWeightGrams: 0,
        });
        movement.step(
            () => 100,
            () => 2000,
        );
    }
    const snapshot = movement.snapshot('first');
    expect(snapshot.player.carriedWeightGrams).toBe(2000);
    expect(snapshot.player.stamina).toBeCloseTo(0.6, 12);
    expect(snapshot.player.position.yMeters).toBeCloseTo(-7, 12);
    expect(movement.snapshot('second').player).toEqual(snapshot.player);
    expect(
        readMovementInput({
            type: 'movement-input',
            protocolVersion,
            sequence: 1,
            direction: { x: 0, y: -1 },
            ...modifiers,
            carriedWeightGrams: 0,
        }),
    ).not.toHaveProperty('carriedWeightGrams');
});

test('both adapters carry authoritative mass and prediction applies it to held movement', () => {
    const snapshot = createMovementSnapshot('world', 1, player(2000), null, [
        { ...player(100), playerId: 'other' },
    ]);
    const read = readMovementSnapshot(snapshot);
    expect(read?.player.carriedWeightGrams).toBe(2000);
    expect(read?.otherPlayers[0]?.carriedWeightGrams).toBe(100);
    const prediction = new MovementPrediction();
    prediction.accept(snapshot, 0);
    prediction.setIntent({ type: 'direction', direction: { x: 0, y: -1 }, ...modifiers }, 0);
    expect(prediction.sample(200)?.stamina).toBeCloseTo(0.92, 12);
    expect(prediction.sample(200)?.position.yMeters).toBeCloseTo(-1.4, 12);
});

test.each([-1, 0.5, NaN, Infinity, '2000', null])(
    'malformed snapshot mass is rejected: %s',
    weight => {
        const snapshot = createMovementSnapshot('world', 1, player(0), null);
        expect(
            isMovementSnapshot({
                ...snapshot,
                player: { ...snapshot.player, carriedWeightGrams: weight },
            }),
        ).toBe(false);
    },
);

test('strong thirst increases sprint cost at the same load and strong hunger only slows recovery', () => {
    const base = { ...player(2000), stamina: 0.5 };
    const { staminaPenaltyAtMs: thirstMs } = thirstSettings;
    const { staminaPenaltyAtMs: hungerMs } = hungerSettings;
    const neutral = staminaEffectsFromNeeds({ thirstMs: thirstMs - 1, hungerMs: hungerMs - 1 });
    const hungry = staminaEffectsFromNeeds({ thirstMs: thirstMs - 1, hungerMs });
    const thirsty = staminaEffectsFromNeeds({ thirstMs, hungerMs: hungerMs - 1 });
    const both = staminaEffectsFromNeeds({ thirstMs, hungerMs });

    for (const [staminaEffects, sprint, recovery] of [
        [neutral, 0.48, 0.505],
        [hungry, 0.48, 0.5025],
        [thirsty, 0.47, 0.505],
        [both, 0.47, 0.5025],
    ] as const) {
        const state = { ...base, staminaEffects };
        expect(
            stepPlayerMovement(state, { x: 0, y: -1 }, movementStepSeconds, modifiers).stamina,
        ).toBeCloseTo(sprint);
        expect(
            stepPlayerToward(state, { xMeters: 0, yMeters: -7 }, movementStepSeconds, modifiers)
                .stamina,
        ).toBeCloseTo(sprint);
        expect(stepPlayerMovement(state, { x: 0, y: 0 }, movementStepSeconds).stamina).toBeCloseTo(
            recovery,
        );
    }
});

test('confirmed stamina effects survive both adapters and drive client prediction', () => {
    const staminaEffects = { isRecoverySlowed: true, isDrainIncreased: true };
    const state = { ...player(2000), staminaEffects };
    const hostSnapshot = createMovementSnapshot('world', 1, state, null);
    const parsed = readMovementSnapshot(hostSnapshot);
    if (parsed === null) throw new Error('Expected a valid movement state.');
    expect(parsed.player.staminaEffects).toEqual(staminaEffects);
    expect(parsed.player.staminaEffects).not.toBe(hostSnapshot.player.staminaEffects);
    expect(hostSnapshot.player.staminaEffects).not.toBe(staminaEffects);

    const prediction = new MovementPrediction();
    prediction.accept(parsed, 0);
    prediction.setIntent({ type: 'direction', direction: { x: 0, y: -1 }, ...modifiers }, 0);
    expect(prediction.sample(200)?.stamina).toBeCloseTo(0.88);
    expect(
        isMovementSnapshot({
            ...hostSnapshot,
            player: {
                ...hostSnapshot.player,
                staminaEffects: { ...staminaEffects, isDrainIncreased: 1 },
            },
        }),
    ).toBe(false);
});
