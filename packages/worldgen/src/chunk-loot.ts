import {
    ammoSettings,
    chunkLootSettings,
    collisionSettings,
    pistolSettings,
    weaponLootSites,
} from '@zombi-survive/content';
import type { GroundItem, WorldChunkKey } from '@zombi-survive/domain';

import { generateWorldChunk } from './chunk.ts';
import { generateWorldWeaponLoot } from './weapon-loot.ts';

/** Add only the layers absent from the original finite overlays. Never a refill. */
export const generateChunkLoot = (key: WorldChunkKey): readonly GroundItem[] => {
    const chunk = generateWorldChunk(key);
    // The original pistol/ammo and scatter layers already cover the origin.
    if (key.chunkX === 0 && key.chunkY === 0) return [];

    let hash = 2166136261;
    const identity = JSON.stringify([key.seed, key.generatorVersion, key.chunkX, key.chunkY]);
    for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);

    const anchor = chunkLootSettings.anchors[(hash >>> 8) % chunkLootSettings.anchors.length];
    const kind = chunkLootSettings.weaponKinds[(hash >>> 0) % chunkLootSettings.weaponKinds.length];
    if (anchor === undefined || kind === undefined) throw new Error('Missing chunk loot content.');

    const existingSite = weaponLootSites.find(
        site => site.chunkX === key.chunkX && site.chunkY === key.chunkY,
    );
    const existingWeapon =
        existingSite === undefined
            ? undefined
            : generateWorldWeaponLoot(key.seed).find(item => item.kind === existingSite.kind);
    const position = existingWeapon?.position ?? {
        xMeters: key.chunkX * chunk.sizeMeters + anchor.xMeters,
        yMeters: key.chunkY * chunk.sizeMeters + anchor.yMeters,
    };
    const half = collisionSettings.playerHalfSizeMeters;
    const ammoPosition = {
        xMeters: position.xMeters,
        yMeters: position.yMeters + chunkLootSettings.ammoOffsetMeters,
    };
    const isBlocked = [position, ammoPosition].some(point =>
        chunk.obstacles.some(
            obstacle =>
                point.xMeters > obstacle.minXMeters - half &&
                point.xMeters < obstacle.maxXMeters + half &&
                point.yMeters > obstacle.minYMeters - half &&
                point.yMeters < obstacle.maxYMeters + half,
        ),
    );
    if (isBlocked) throw new Error('Chunk loot overlaps world geometry.');

    const prefix = `chunk-loot-v1:${String(key.chunkX)}:${String(key.chunkY)}`;
    const weapon: GroundItem =
        kind === 'pistol'
            ? {
                  itemId: `${prefix}:weapon`,
                  kind,
                  rounds: pistolSettings.magazineCapacity,
                  magazineCapacity: pistolSettings.magazineCapacity,
                  position: { ...position },
              }
            : { itemId: `${prefix}:weapon`, kind, position: { ...position } };
    const ammo: GroundItem = {
        itemId: `${prefix}:ammo`,
        kind: 'ammo9mm',
        quantity: ammoSettings.stackQuantity,
        position: ammoPosition,
    };

    return existingWeapon === undefined ? [weapon, ammo] : [ammo];
};
