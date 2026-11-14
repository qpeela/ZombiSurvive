import {
    ammoSettings,
    collisionSettings,
    expandedWeaponLootSites,
    pistolSettings,
    worldGenerationSettings,
} from '@zombi-survive/content';
import type { GroundItem, WorldPosition } from '@zombi-survive/domain';

import { generateWorldChunk } from './chunk.ts';

/** A finite additive overlay; geometry and the original loot layers remain unchanged. */
export const generateExpandedLoot = (seed: string): readonly GroundItem[] => {
    const chunk = generateWorldChunk({
        seed,
        generatorVersion: worldGenerationSettings.generatorVersion,
        chunkX: 0,
        chunkY: 0,
    });
    const half = collisionSettings.playerHalfSizeMeters;
    const offsets = [0, -2, 2, -4, 4, -6, 6];
    const placed: WorldPosition[] = [];
    const items: GroundItem[] = [];
    for (const site of expandedWeaponLootSites) {
        const candidates = offsets.flatMap(y =>
            offsets.map(x => ({ xMeters: site.xMeters + x, yMeters: site.yMeters + y })),
        );
        const position = candidates.find(candidate => {
            const isInside =
                Math.abs(candidate.xMeters) < chunk.sizeMeters / 2 - half &&
                Math.abs(candidate.yMeters) < chunk.sizeMeters / 2 - half;
            const isSeparated = placed.every(
                other =>
                    Math.hypot(
                        candidate.xMeters - other.xMeters,
                        candidate.yMeters - other.yMeters,
                    ) >= 4,
            );
            const isBlocked = chunk.obstacles.some(
                obstacle =>
                    candidate.xMeters > obstacle.minXMeters - half &&
                    candidate.xMeters < obstacle.maxXMeters + half &&
                    candidate.yMeters > obstacle.minYMeters - half &&
                    candidate.yMeters < obstacle.maxYMeters + half,
            );
            return isInside && isSeparated && !isBlocked;
        });
        if (position === undefined) throw new Error('No accessible expanded loot site.');
        placed.push(position);
        const base = {
            itemId: site.itemId,
            kind: site.kind,
            position: Object.freeze({ ...position }),
        };
        if (site.kind === 'pistol') {
            items.push(
                Object.freeze({
                    ...base,
                    kind: site.kind,
                    rounds: pistolSettings.magazineCapacity,
                    magazineCapacity: pistolSettings.magazineCapacity,
                }),
            );
            items.push(
                Object.freeze({
                    itemId: `${site.itemId}:ammo`,
                    kind: 'ammo9mm',
                    quantity: ammoSettings.stackQuantity,
                    position: Object.freeze({ ...position }),
                }),
            );
        } else items.push(Object.freeze({ ...base, kind: site.kind }));
    }
    return Object.freeze(items);
};
export const initialExpandedLoot = generateExpandedLoot(worldGenerationSettings.initialSeed);
