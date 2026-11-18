import { weatherSettings, type WorldWeather } from '@zombi-survive/content';

/** No browser timer or random state: an empty running host already advances this clock. */
export const getWorldWeather = (worldTimeMs: number): WorldWeather => {
    const isValidTime = Number.isSafeInteger(worldTimeMs) && worldTimeMs >= 0;
    if (!isValidTime) throw new RangeError('Invalid weather world time.');

    const cycleTimeMs = worldTimeMs % weatherSettings.cycleWorldMs;
    const isFoggy =
        cycleTimeMs >= weatherSettings.fogStartsAtWorldMs &&
        cycleTimeMs < weatherSettings.fogEndsAtWorldMs;
    if (isFoggy) return 'fog';

    const rainTimeMs = cycleTimeMs % weatherSettings.rainCycleWorldMs;
    const isRaining =
        rainTimeMs >= weatherSettings.rainStartsAtWorldMs &&
        rainTimeMs < weatherSettings.rainEndsAtWorldMs;

    return isRaining ? 'rain' : 'clear';
};
