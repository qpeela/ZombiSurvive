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
