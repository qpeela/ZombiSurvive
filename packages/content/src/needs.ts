import type { GroundItem } from '@zombi-survive/domain';

const worldHourMs = 60 * 60 * 1000;
export const thirstSettings = Object.freeze({
    maximumMs: 8 * worldHourMs,
    noticeableMs: 2 * worldHourMs,
    servingReliefMs: 4 * worldHourMs,
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
