import { collisionSettings, pistolSettings, worldGenerationSettings } from '@zombi-survive/content';
import type { GroundItem } from '@zombi-survive/domain';

import { generateWorldChunk } from './chunk.ts';
import { generateWorldWeaponLoot } from './weapon-loot.ts';

export const generateWorldPistolLoot = (seed: string): readonly GroundItem[] => {
    const base = generateWorldWeaponLoot(seed)[0];
    if (base === undefined) throw new Error('Pistol overlay needs a loot site.');
    const chunk = generateWorldChunk({
        seed,
        generatorVersion: worldGenerationSettings.generatorVersion,
        chunkX: 0,
        chunkY: 0,
    });
    const half = collisionSettings.playerHalfSizeMeters;
    const position = [
        { xMeters: base.position.xMeters, yMeters: base.position.yMeters + 2 },
        base.position,
    ].find(
        candidate =>
            !chunk.obstacles.some(obstacle => {
                const overlapsX =
                    candidate.xMeters > obstacle.minXMeters - half &&
                    candidate.xMeters < obstacle.maxXMeters + half;
                const overlapsY =
                    candidate.yMeters > obstacle.minYMeters - half &&
                    candidate.yMeters < obstacle.maxYMeters + half;
                return overlapsX && overlapsY;
            }),
    );
    if (position === undefined) throw new Error('Pistol loot site overlaps geometry.');
    return Object.freeze([
        Object.freeze({
            itemId: 'pistol-v1:0:0',
            kind: 'pistol' as const,
            rounds: pistolSettings.magazineCapacity,
            magazineCapacity: pistolSettings.magazineCapacity,
            position: Object.freeze({ ...position }),
        }),
    ]);
};
export const initialWorldPistolLoot = generateWorldPistolLoot(worldGenerationSettings.initialSeed);
