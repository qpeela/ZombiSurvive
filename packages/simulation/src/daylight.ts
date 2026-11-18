import { type DaylightPhase, daylightPhases, worldClockSettings } from '@zombi-survive/content';

export const getDaylightPhase = (worldTimeMs: number): DaylightPhase => {
    const isValidTime = Number.isSafeInteger(worldTimeMs) && worldTimeMs >= 0;
    if (!isValidTime) throw new RangeError('Invalid daylight world time.');

    const timeOfDayMs =
        ((worldTimeMs % worldClockSettings.dayDurationMs) + worldClockSettings.startTimeOfDayMs) %
        worldClockSettings.dayDurationMs;
    const hour = timeOfDayMs / (60 * 60 * 1000);
    if (hour >= daylightPhases.night.startHour) return 'night';

    if (hour >= daylightPhases.dusk.startHour) return 'dusk';

    if (hour >= daylightPhases.day.startHour) return 'day';

    if (hour >= daylightPhases.dawn.startHour) return 'dawn';

    return 'night';
};
