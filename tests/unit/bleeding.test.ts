import { combatSettings } from '@zombi-survive/content';
import { stepBleeding, woundFromZombieHit } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const healthy = { playerId: 'solo', health: 90, bleedingTicks: 0 };

test('wound chance has an explicit boundary and a new wound starts with a full interval', () => {
    expect(woundFromZombieHit(healthy, 0)).toEqual({ ...healthy, bleedingTicks: 100 });
    expect(woundFromZombieHit(healthy, 0.249)).toEqual({ ...healthy, bleedingTicks: 100 });
    expect(woundFromZombieHit(healthy, combatSettings.bleedingChance)).toBe(healthy);
    expect(healthy.bleedingTicks).toBe(0);
    expect(woundFromZombieHit({ ...healthy, health: 0 }, 0).bleedingTicks).toBe(0);
});

test('repeat wounds neither stack nor reset the remaining interval', () => {
    const state = { ...healthy, bleedingTicks: 3 };
    expect(woundFromZombieHit(state, 0)).toBe(state);
    expect(stepBleeding(woundFromZombieHit(state, 0))).toEqual({ ...state, bleedingTicks: 2 });
});

test('only the exact fixed-step boundary loses HP and starts the next interval', () => {
    let state = woundFromZombieHit(healthy, 0);
    for (let tick = 0; tick < 99; tick++) state = stepBleeding(state);
    expect(state).toEqual({ ...healthy, bleedingTicks: 1 });
    state = stepBleeding(state);
    expect(state).toEqual({ ...healthy, health: 89, bleedingTicks: 100 });
    for (let tick = 0; tick < 100; tick++) state = stepBleeding(state);
    expect(state.health).toBe(88);
});

test('unwounded health is stable; the last HP reaches zero once and freezes the wound', () => {
    expect(stepBleeding(healthy)).toBe(healthy);
    const state = stepBleeding({ ...healthy, health: 1, bleedingTicks: 1 });
    expect(state).toEqual({ ...healthy, health: 0, bleedingTicks: 100 });
    expect(stepBleeding(state)).toBe(state);
});

test('render frame grouping cannot change the result of the same fixed world steps', () => {
    const simulate = (frames: number, ticksPerFrame: number) => {
        let state = { ...healthy, bleedingTicks: 41 };
        for (let frame = 0; frame < frames; frame++)
            for (let tick = 0; tick < ticksPerFrame; tick++) state = stepBleeding(state);
        return state;
    };
    expect(simulate(240, 1)).toEqual(simulate(60, 4));
    expect(simulate(240, 1)).toEqual({ ...healthy, health: 88, bleedingTicks: 1 });
});
