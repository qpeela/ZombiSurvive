import {
    ammoSettings,
    chunkLootSettings,
    collisionSettings,
    medicalOutpost,
    militaryWarehouse,
    pistolSettings,
    weaponLootSites,
} from '@zombi-survive/content';
import type { GroundItem, WorldChunkKey } from '@zombi-survive/domain';

import { generateWorldChunk } from './chunk.ts';
import { generateWorldWeaponLoot } from './weapon-loot.ts';

const chunkLootPrefix = (chunkX: number, chunkY: number): string =>
    `chunk-loot-v1:${String(chunkX)}:${String(chunkY)}`;

export const warehouseLoot = Object.freeze(
    militaryWarehouse.stock.map(({ id, kind, xMeters, yMeters }): GroundItem => {
        const prefix = chunkLootPrefix(militaryWarehouse.chunkX, militaryWarehouse.chunkY);
        const itemId = `${prefix}:${id}`;
        const position = Object.freeze({ xMeters, yMeters });
        if (kind === 'pistol') {
            return Object.freeze({
                itemId,
                kind,
                position,
                rounds: pistolSettings.magazineCapacity,
                magazineCapacity: pistolSettings.magazineCapacity,
            });
        }

        return Object.freeze({ itemId, kind, position, quantity: ammoSettings.stackQuantity });
    }),
);

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

    const prefix = chunkLootPrefix(key.chunkX, key.chunkY);
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

    const loot: GroundItem[] = existingWeapon === undefined ? [weapon, ammo] : [ammo];
    const isOutpost = key.chunkX === medicalOutpost.chunkX && key.chunkY === medicalOutpost.chunkY;
    if (isOutpost)
        loot.push({
            itemId: medicalOutpost.bandageItemId,
            kind: 'bandage',
            position: { ...medicalOutpost.bandagePosition },
        });

    const isWarehouseColumn = key.chunkX === militaryWarehouse.chunkX;
    const isWarehouseRow = key.chunkY === militaryWarehouse.chunkY;
    if (isWarehouseColumn && isWarehouseRow) loot.push(...warehouseLoot);

    return loot;
};
