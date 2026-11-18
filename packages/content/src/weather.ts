/** Reproducible prototype cycle, driven by elapsed host world time (starts at 08:00). */
export const weatherSettings = Object.freeze({
    cycleWorldMs: 48 * 3_600_000,
    rainCycleWorldMs: 12 * 3_600_000,
    fogStartsAtWorldMs: 24 * 3_600_000,
    fogEndsAtWorldMs: 40 * 3_600_000,
    rainStartsAtWorldMs: 4 * 3_600_000,
    rainEndsAtWorldMs: 8 * 3_600_000,
});
export const weatherPhases = Object.freeze({
    clear: Object.freeze({ label: 'Ясно' }),
    rain: Object.freeze({ label: 'Дождь' }),
    fog: Object.freeze({ label: 'Туман' }),
});
export type WorldWeather = keyof typeof weatherPhases;

export const fogSettings = Object.freeze({
    visibilityMeters: 8,
    flashlightRangeMeters: 6,
    dayColor: 0x8f9e9b,
    nightColor: 0x1a2931,
    insideOpacity: 0.2,
});
