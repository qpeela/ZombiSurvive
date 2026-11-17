import { worldClockSettings } from '@zombi-survive/content';

import { movementStepSeconds } from './movement.ts';

/** Only running host steps advance the world. Real-world absence is never added. */
export const stepWorldClock = (worldTimeMs: number, stepSeconds: number): number => {
    const isValidTime = Number.isSafeInteger(worldTimeMs) && worldTimeMs >= 0;
    if (!isValidTime || stepSeconds !== movementStepSeconds)
        throw new RangeError('World clock requires valid time and the fixed step.');
    const next = worldTimeMs + Math.round(stepSeconds * 1000 * worldClockSettings.timeScale);
    if (!Number.isSafeInteger(next)) throw new RangeError('World clock limit reached.');

    return next;
};
