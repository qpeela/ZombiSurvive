/** Reproducible prototype cycle, driven by elapsed host world time (starts at 08:00). */
export const weatherSettings = Object.freeze({
    cycleWorldMs: 12 * 3_600_000,
    rainStartsAtWorldMs: 4 * 3_600_000,
    rainEndsAtWorldMs: 8 * 3_600_000,
});
export const weatherPhases = Object.freeze({
    clear: Object.freeze({ label: 'Ясно' }),
    rain: Object.freeze({ label: 'Дождь' }),
});
export type WorldWeather = keyof typeof weatherPhases;
