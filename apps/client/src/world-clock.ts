import { worldClockSettings } from '@zombi-survive/content';

export const formatWorldTime = (worldTimeMs: number): string => {
    const minutes = Math.floor((worldTimeMs + worldClockSettings.startTimeOfDayMs) / 60_000);
    const minutesPerDay = worldClockSettings.dayDurationMs / 60_000;
    const day = Math.floor(minutes / minutesPerDay) + 1;
    const hour = Math.floor((minutes % minutesPerDay) / 60);
    const minute = minutes % 60;

    return `День ${String(day)} · ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};
