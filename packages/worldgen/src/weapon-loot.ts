import {
    collisionSettings,
    weaponLootSites,
    worldGenerationSettings,
    worldLootSettings,
} from '@zombi-survive/content';
import type { GroundItem } from '@zombi-survive/domain';

import { generateWorldChunk } from './chunk.ts';

/** Seeded loot overlay v1. Existing terrain/obstacle bytes remain unchanged. */
export const generateWorldWeaponLoot = (seed: string): readonly GroundItem[] =>
    Object.freeze(
        weaponLootSites.map(site => {
            const chunk = generateWorldChunk({
                seed,
                generatorVersion: worldGenerationSettings.generatorVersion,
                chunkX: site.chunkX,
                chunkY: site.chunkY,
            });
            let hash = 2166136261;
            for (const character of seed)
                hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
            const position = Object.freeze({
                xMeters: site.chunkX * chunk.sizeMeters - 10 - ((hash >>> 0) % 3) * 2,
                yMeters: site.chunkY * chunk.sizeMeters - 8,
            });
            const half = collisionSettings.playerHalfSizeMeters;
            const isBlocked = chunk.obstacles.some(obstacle => {
                const isX =
                    position.xMeters > obstacle.minXMeters - half &&
                    position.xMeters < obstacle.maxXMeters + half;
                const isY =
                    position.yMeters > obstacle.minYMeters - half &&
                    position.yMeters < obstacle.maxYMeters + half;

                return isX && isY;
            });

            if (isBlocked) throw new Error('Weapon loot site overlaps world geometry.');

            return Object.freeze({
                itemId: `loot-v${String(worldLootSettings.version)}:${String(site.chunkX)}:${String(site.chunkY)}:${site.kind}`,
                kind: site.kind,
                position,
            });
        }),
    );

export const initialWorldWeaponLoot = generateWorldWeaponLoot(worldGenerationSettings.initialSeed);
