import { restSettings, workshopBench } from '@zombi-survive/content';
import type { WorldPosition } from '@zombi-survive/domain';
import {
    isRestCommand,
    isRestState,
    protocolVersion,
    type RestCancellation,
} from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

import { LocalWorldRest } from '../../apps/server/src/local-world-rest.ts';

const startedAtWorldMs = 6000;
const finishedAtWorldMs = startedAtWorldMs + restSettings.durationWorldMs;
const atBench: { readonly position: WorldPosition; readonly health: number } = {
    position: workshopBench.position,
    health: 100,
};
const sessionId = 'first-tab';

const begin = (rest: LocalWorldRest) => {
    rest.request(sessionId);
    expect(
        rest.step({
            worldTimeMs: startedAtWorldMs,
            fatigueMs: restSettings.restedFatigueMs + 1,
            playerFor: () => atBench,
        }),
    ).toBe(false);
    expect(rest.snapshot(startedAtWorldMs)).toEqual({
        state: 'resting',
        elapsedWorldMs: 0,
        durationWorldMs: restSettings.durationWorldMs,
    });
};

test('rest finishes once at its world-time deadline and ignores duplicate requests', () => {
    const rest = new LocalWorldRest();
    begin(rest);
    rest.request(sessionId);
    rest.request('second-tab');
    const stepAt = (worldTimeMs: number) =>
        rest.step({
            worldTimeMs,
            fatigueMs: restSettings.restedFatigueMs + 1,
            playerFor: () => atBench,
        });

    expect(stepAt(finishedAtWorldMs - 1)).toBe(false);
    expect(rest.snapshot(finishedAtWorldMs - 1)).toMatchObject({
        state: 'resting',
        elapsedWorldMs: restSettings.durationWorldMs - 1,
    });
    expect(stepAt(finishedAtWorldMs)).toBe(true);
    expect(stepAt(finishedAtWorldMs + 1)).toBe(false);
    expect(rest.snapshot(finishedAtWorldMs)).toEqual({ state: 'completed' });
    expect(rest.snapshot(finishedAtWorldMs + restSettings.feedbackWorldMs)).toEqual({
        state: 'idle',
    });
});

test.each([
    ['movement', { ...atBench, position: { xMeters: -62.8, yMeters: -8 } }],
    ['damage', { ...atBench, health: 99 }],
    ['control', undefined],
] satisfies readonly [RestCancellation, typeof atBench | undefined][])(
    '%s cancels at the deadline before any fatigue reduction',
    (reason, player) => {
        const rest = new LocalWorldRest();
        begin(rest);

        expect(
            rest.step({
                worldTimeMs: finishedAtWorldMs,
                fatigueMs: restSettings.restedFatigueMs + 1,
                playerFor: () => player,
            }),
        ).toBe(false);
        expect(rest.snapshot(finishedAtWorldMs)).toEqual({ state: 'cancelled', reason });
    },
);

test('out-of-range, dead and insufficiently tired players cannot start a rest', () => {
    for (const [player, fatigueMs] of [
        [{ ...atBench, position: { xMeters: -30, yMeters: 1 } }, restSettings.restedFatigueMs + 1],
        [{ ...atBench, health: 0 }, restSettings.restedFatigueMs + 1],
        [atBench, restSettings.restedFatigueMs],
    ] as const) {
        const rest = new LocalWorldRest();
        rest.request(sessionId);
        expect(
            rest.step({ worldTimeMs: startedAtWorldMs, fatigueMs, playerFor: () => player }),
        ).toBe(false);
        expect(rest.snapshot(startedAtWorldMs)).toEqual({ state: 'idle' });
    }
});

test('only the controlling tab can cancel and losing it before validation clears the request', () => {
    const rest = new LocalWorldRest();
    rest.request(sessionId);
    rest.loseControl(sessionId, 0);
    rest.step({
        worldTimeMs: startedAtWorldMs,
        fatigueMs: restSettings.restedFatigueMs + 1,
        playerFor: () => atBench,
    });
    expect(rest.snapshot(startedAtWorldMs)).toEqual({ state: 'idle' });

    begin(rest);
    rest.loseControl('other-tab', startedAtWorldMs);
    expect(rest.snapshot(startedAtWorldMs).state).toBe('resting');
    rest.loseControl(sessionId, startedAtWorldMs);
    expect(rest.snapshot(startedAtWorldMs)).toEqual({ state: 'cancelled', reason: 'control' });
    rest.reset();
    expect(rest.snapshot(startedAtWorldMs)).toEqual({ state: 'idle' });
});

test('rest protocol rejects inappropriate commands, cancellation reasons and elapsed time', () => {
    expect(isRestCommand({ type: 'rest-at-bench', protocolVersion })).toBe(true);
    expect(isRestCommand({ type: 'rest-at-bench', protocolVersion: 0 })).toBe(false);
    expect(isRestCommand({ type: 'advance-rest', protocolVersion })).toBe(false);
    expect(isRestState({ state: 'cancelled', reason: 'control' })).toBe(true);
    expect(isRestState({ state: 'cancelled', reason: 'other' })).toBe(false);
    expect(isRestState({ state: 'resting', elapsedWorldMs: 0, durationWorldMs: 6000 })).toBe(true);
    expect(isRestState({ state: 'resting', elapsedWorldMs: 6000, durationWorldMs: 6000 })).toBe(
        false,
    );
});
