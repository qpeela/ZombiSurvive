import { worldClockSettings } from '@zombi-survive/content';
import { getDaylightPhase } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const hourMs = 3_600_000;
const atHour = (hour: number) =>
    (hour * hourMs - worldClockSettings.startTimeOfDayMs + worldClockSettings.dayDurationMs) %
    worldClockSettings.dayDurationMs;

test.each([
    [0, 'night'],
    [4.999, 'night'],
    [5, 'dawn'],
    [6.999, 'dawn'],
    [7, 'day'],
    [17.999, 'day'],
    [18, 'dusk'],
    [19.999, 'dusk'],
    [20, 'night'],
    [23.999, 'night'],
] as const)('host time at hour %s produces %s on every day', (hour, phase) => {
    for (const days of [0, 1, 50])
        expect(getDaylightPhase(atHour(hour) + days * worldClockSettings.dayDurationMs)).toBe(
            phase,
        );
});

test('initial 08:00 is day; invalid and absent world clocks never invent a phase', () => {
    expect(getDaylightPhase(0)).toBe('day');
    for (const time of [-1, 0.5, NaN, Infinity])
        expect(() => getDaylightPhase(time)).toThrow(RangeError);
});
