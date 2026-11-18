import { type DaylightPhase } from '@zombi-survive/content';
import { isPositionVisible } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const observer = { xMeters: -20, yMeters: 10 };

test.each<[DaylightPhase, number]>([
    ['day', 22],
    ['dawn', 12],
    ['dusk', 8],
    ['night', 3],
])('%s includes its radius %sm and hides a target immediately outside', (phase, radius) => {
    expect(
        isPositionVisible({
            observer,
            target: { xMeters: observer.xMeters + radius, yMeters: observer.yMeters },
            phase,
        }),
    ).toBe(true);
    expect(
        isPositionVisible({
            observer,
            target: { xMeters: observer.xMeters + radius + 0.001, yMeters: observer.yMeters },
            phase,
        }),
    ).toBe(false);
    expect(isPositionVisible({ observer, target: observer, phase })).toBe(true);
});

test('visibility uses radial distance in negative coordinates, absent observers hide everything and legacy clocks preserve daylight', () => {
    const target = { xMeters: -17, yMeters: 14 };
    expect(isPositionVisible({ observer, target, phase: 'day' })).toBe(true);
    expect(isPositionVisible({ observer, target, phase: 'night' })).toBe(false);
    expect(isPositionVisible({ observer: null, target, phase: 'day' })).toBe(false);
    expect(isPositionVisible({ observer, target, phase: null })).toBe(true);
    expect(
        isPositionVisible({ observer, target: { xMeters: NaN, yMeters: 0 }, phase: 'day' }),
    ).toBe(false);
});

test('a flashlight reveals targets inside its cone and range, and ambient vision remains around the player', () => {
    const origin = { xMeters: 0, yMeters: 0 };
    const input = { observer: origin, target: { xMeters: 8, yMeters: 0 }, phase: 'night' as const };
    expect(isPositionVisible(input)).toBe(false);
    expect(isPositionVisible({ ...input, flashlight: { angleRadians: 0 } })).toBe(true);
    expect(isPositionVisible({ ...input, flashlight: { angleRadians: Math.PI } })).toBe(false);
    expect(
        isPositionVisible({
            ...input,
            target: { xMeters: -2, yMeters: 0 },
            flashlight: { angleRadians: 0 },
        }),
    ).toBe(true);
});

test('flashlight range is inclusive and does not reveal targets beyond the configured distance', () => {
    const input = { observer, phase: 'night' as const, flashlight: { angleRadians: 0 } };
    expect(
        isPositionVisible({
            ...input,
            target: { xMeters: observer.xMeters + 12, yMeters: observer.yMeters },
        }),
    ).toBe(true);
    expect(
        isPositionVisible({
            ...input,
            target: { xMeters: observer.xMeters + 12.001, yMeters: observer.yMeters },
        }),
    ).toBe(false);
});

test('both cone edges are inclusive, and a target immediately outside is hidden', () => {
    for (const direction of [-1, 1]) {
        const edge = (direction * Math.PI) / 6;
        const target = (angle: number) => ({
            xMeters: Math.cos(angle) * 10,
            yMeters: Math.sin(angle) * 10,
        });
        const input = {
            observer: { xMeters: 0, yMeters: 0 },
            phase: 'night' as const,
            flashlight: { angleRadians: 0 },
        };
        expect(isPositionVisible({ ...input, target: target(edge) })).toBe(true);
        expect(isPositionVisible({ ...input, target: target(edge + direction * 0.001) })).toBe(
            false,
        );
    }
});

test('aim wraps across minus/plus pi without flashing the opposite side', () => {
    const input = {
        observer: { xMeters: 0, yMeters: 0 },
        phase: 'night' as const,
        flashlight: { angleRadians: Math.PI - 0.1 },
    };
    expect(isPositionVisible({ ...input, target: { xMeters: -10, yMeters: -0.2 } })).toBe(true);
    expect(isPositionVisible({ ...input, target: { xMeters: 10, yMeters: 0.2 } })).toBe(false);
});

test('a disconnected observer and invalid beam cannot reveal a distant target', () => {
    const target = { xMeters: 8, yMeters: 0 };
    expect(
        isPositionVisible({
            observer: null,
            target,
            phase: 'night',
            flashlight: { angleRadians: 0 },
        }),
    ).toBe(false);
    expect(
        isPositionVisible({
            observer: { xMeters: 0, yMeters: 0 },
            target,
            phase: 'night',
            flashlight: { angleRadians: NaN },
        }),
    ).toBe(false);
});
