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

test('fog spans the second day from 08:00 until midnight, overrides rain, and repeats without wall-clock state', () => {
    for (const offset of [0, weatherSettings.cycleWorldMs * 50]) {
        expect(getWorldWeather(offset + 24 * 3_600_000 - 1)).toBe('clear');
        expect(getWorldWeather(offset + 24 * 3_600_000)).toBe('fog');
        expect(getWorldWeather(offset + 28 * 3_600_000)).toBe('fog');
        expect(getWorldWeather(offset + 40 * 3_600_000 - 1)).toBe('fog');
        // At midnight the regular 00:00–04:00 rain resumes.
        expect(getWorldWeather(offset + 40 * 3_600_000)).toBe('rain');
    }
    expect(getWorldWeather(0)).toBe('clear');
    expect(getWorldWeather(24 * 3_600_000)).toBe('fog');
});
