/** Preliminary visual balance; the host clock is the only phase authority. */
export const daylightPhases = Object.freeze({
    dawn: Object.freeze({ startHour: 5, label: 'Рассвет', color: 0xc69062, opacity: 0.22 }),
    day: Object.freeze({ startHour: 7, label: 'День', color: 0xffe7ac, opacity: 0.03 }),
    dusk: Object.freeze({ startHour: 18, label: 'Сумерки', color: 0x633c68, opacity: 0.38 }),
    night: Object.freeze({ startHour: 20, label: 'Ночь', color: 0x030c22, opacity: 0.76 }),
});
export type DaylightPhase = keyof typeof daylightPhases;
