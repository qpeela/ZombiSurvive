/** A finite v1 overlay, independent of the terrain generator. No respawn. */
export const worldLootSettings = Object.freeze({ version: 1, visibilityMeters: 8 });
export const chunkLootSettings = Object.freeze({
    ammoOffsetMeters: 2,
    weaponKinds: Object.freeze(['club', 'knife', 'crowbar', 'axe', 'pistol'] as const),
    anchors: Object.freeze([
        Object.freeze({ xMeters: -10, yMeters: -8 }),
        Object.freeze({ xMeters: 10, yMeters: -8 }),
        Object.freeze({ xMeters: -10, yMeters: 8 }),
        Object.freeze({ xMeters: 10, yMeters: 8 }),
    ]),
});
export const weaponLootSites = Object.freeze([
    Object.freeze({ chunkX: 0, chunkY: 0, kind: 'knife' as const }),
    Object.freeze({ chunkX: 1, chunkY: 0, kind: 'club' as const }),
    Object.freeze({ chunkX: 0, chunkY: 1, kind: 'crowbar' as const }),
    Object.freeze({ chunkX: -1, chunkY: 0, kind: 'axe' as const }),
]);

/** Additional starting-region sites; IDs and anchors are stable across saves. */
export const expandedWeaponLootSites = Object.freeze([
    Object.freeze({ itemId: 'scatter-v1:club', kind: 'club' as const, xMeters: -18, yMeters: -14 }),
    Object.freeze({ itemId: 'scatter-v1:knife', kind: 'knife' as const, xMeters: 18, yMeters: 14 }),
    Object.freeze({
        itemId: 'scatter-v1:crowbar',
        kind: 'crowbar' as const,
        xMeters: -4,
        yMeters: 20,
    }),
    Object.freeze({ itemId: 'scatter-v1:axe', kind: 'axe' as const, xMeters: 20, yMeters: 4 }),
    Object.freeze({
        itemId: 'scatter-v1:pistol:west',
        kind: 'pistol' as const,
        xMeters: -18,
        yMeters: 14,
    }),
    Object.freeze({
        itemId: 'scatter-v1:pistol:east',
        kind: 'pistol' as const,
        xMeters: 18,
        yMeters: -14,
    }),
]);

// Six game hours at the current clock scale: six running host minutes.
export const lootRestockSettings = Object.freeze({ periodWorldMs: 6 * 60 * 60 * 1000 });
