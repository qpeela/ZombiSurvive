import type { GroundItem } from '@zombi-survive/domain';

const worldHourMs = 60 * 60 * 1000;
export const thirstSettings = Object.freeze({
    maximumMs: 8 * worldHourMs,
    noticeableMs: 2 * worldHourMs,
    servingReliefMs: 4 * worldHourMs,
    staminaPenaltyAtMs: 6 * worldHourMs,
    drainMultiplier: 1.5,
});

export const hungerSettings = Object.freeze({
    maximumMs: 12 * worldHourMs,
    noticeableMs: 3 * worldHourMs,
    rationReliefMs: 6 * worldHourMs,
    staminaPenaltyAtMs: 8 * worldHourMs,
    recoveryMultiplier: 0.5,
});

export const fatigueSettings = Object.freeze({
    maximumMs: 24 * worldHourMs,
    noticeableMs: 12 * worldHourMs,
    staminaPenaltyAtMs: 16 * worldHourMs,
    maximumStamina: 0.65,
});

export const rationLoot = Object.freeze({
    chunkX: 0,
    chunkY: 1,
    item: Object.freeze({
        itemId: 'chunk-loot-v1:0:1:ready-ration',
        kind: 'ration',
        position: Object.freeze({ xMeters: 0, yMeters: 64 }),
    } satisfies GroundItem),
});

export const workshopWater = Object.freeze({
    chunkX: -1,
    chunkY: 0,
    item: Object.freeze({
        itemId: 'chunk-loot-v1:-1:0:workshop-water',
        kind: 'waterBottle',
        servings: 1,
        position: Object.freeze({ xMeters: -65, yMeters: -2 }),
    } satisfies GroundItem),
});
