import type { GroundItem } from '@zombi-survive/domain';

/** New uses for existing ruins. Floors and markings leave collision geometry intact. */
export const militaryWarehouse = Object.freeze({
    id: 'military-warehouse',
    name: 'Военный склад',
    chunkX: 0,
    chunkY: -1,
    entrance: Object.freeze({ xMeters: -1, yMeters: -72 }),
    floor: Object.freeze({
        minXMeters: -5,
        minYMeters: -70,
        widthMeters: 10.5,
        heightMeters: 11.5,
    }),
    stock: Object.freeze([
        Object.freeze({ id: 'warehouse-pistol-1', kind: 'pistol', xMeters: -1, yMeters: -68 }),
        Object.freeze({ id: 'warehouse-ammo-1', kind: 'ammo9mm', xMeters: 1, yMeters: -68 }),
        Object.freeze({ id: 'warehouse-pistol-2', kind: 'pistol', xMeters: -1, yMeters: -63 }),
        Object.freeze({ id: 'warehouse-ammo-2', kind: 'ammo9mm', xMeters: 1, yMeters: -63 }),
    ] as const),
});

export const workshopBench = Object.freeze({
    id: 'workshop-bench',
    position: Object.freeze({ xMeters: -63, yMeters: -8 }),
});

export const workshopCanopy = Object.freeze({
    minXMeters: -65,
    maxXMeters: -61,
    minYMeters: -10,
    maxYMeters: -7,
});

const workshopCratePosition = Object.freeze({ xMeters: -59.5, yMeters: 0 });

export const workshopCrate = Object.freeze({
    id: 'workshop-crate',
    name: 'Ящик мастерской',
    capacity: 4,
    chunkX: -1,
    chunkY: 0,
    position: workshopCratePosition,
    stock: Object.freeze({
        itemId: 'chunk-loot-v1:-1:0:crate-bandage',
        kind: 'bandage',
        position: workshopCratePosition,
    } satisfies GroundItem),
});

export const worldLandmarks = Object.freeze([
    militaryWarehouse,
    Object.freeze({
        id: 'repair-workshop',
        name: 'Ремонтная мастерская',
        chunkX: -1,
        chunkY: 0,
        entrance: Object.freeze({ xMeters: -65, yMeters: -6 }),
        floor: Object.freeze({
            minXMeters: -69,
            minYMeters: -4,
            widthMeters: 10.5,
            heightMeters: 9.5,
        }),
    }),
] as const);
