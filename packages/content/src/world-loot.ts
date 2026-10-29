/** A finite v1 overlay, independent of the terrain generator. No respawn. */
export const worldLootSettings = Object.freeze({ version: 1, visibilityMeters: 8 });
export const weaponLootSites = Object.freeze([
    Object.freeze({ chunkX: 0, chunkY: 0, kind: 'knife' as const }),
    Object.freeze({ chunkX: 1, chunkY: 0, kind: 'club' as const }),
    Object.freeze({ chunkX: 0, chunkY: 1, kind: 'crowbar' as const }),
    Object.freeze({ chunkX: -1, chunkY: 0, kind: 'axe' as const }),
]);
