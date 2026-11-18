import { weatherSettings } from '@zombi-survive/content';
import { getWorldWeather } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

test.each([
    [0, 'clear'],
    [4 * 3_600_000 - 1, 'clear'],
    [4 * 3_600_000, 'rain'],
    [8 * 3_600_000 - 1, 'rain'],
    [8 * 3_600_000, 'clear'],
    [12 * 3_600_000 - 1, 'clear'],
] as const)('elapsed host time %s gives %s across repeated cycles', (time, weather) => {
    for (const cycles of [0, 1, 10_000]) {
        expect(getWorldWeather(time + cycles * weatherSettings.cycleWorldMs)).toBe(weather);
    }
});

test('weather never invents a clock for invalid data', () => {
    for (const value of [-1, NaN, Infinity, 1.5]) {
        expect(() => getWorldWeather(value)).toThrow(RangeError);
    }
});
