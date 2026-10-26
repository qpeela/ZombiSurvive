import type { ZombieState } from '@zombi-survive/domain';

export const zombieSettings = Object.freeze({
    spawnOffsetsMeters: Object.freeze([-24, 0, 24]),
    speedMetersPerSecond: 1.5,
    sightRangeMeters: 12,
    pursuitRangeMeters: 18,
    stopRangeMeters: 0.9,
    navigationMarginMeters: 4,
});

export const initialZombie: ZombieState = Object.freeze({
    zombieId: 'slow-zombie-1',
    position: Object.freeze({ xMeters: -8, yMeters: 0 }),
    targetPlayerId: null,
});
