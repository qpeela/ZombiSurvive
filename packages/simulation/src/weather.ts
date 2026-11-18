import { weatherSettings, type WorldWeather } from '@zombi-survive/content';

/** No browser timer or random state: an empty running host already advances this clock. */
export const getWorldWeather = (worldTimeMs: number): WorldWeather => {
    const isValidTime = Number.isSafeInteger(worldTimeMs) && worldTimeMs >= 0;
    if (!isValidTime) throw new RangeError('Invalid weather world time.');

    const cycleTimeMs = worldTimeMs % weatherSettings.cycleWorldMs;
    const isRaining =
        cycleTimeMs >= weatherSettings.rainStartsAtWorldMs &&
        cycleTimeMs < weatherSettings.rainEndsAtWorldMs;

    return isRaining ? 'rain' : 'clear';
};
