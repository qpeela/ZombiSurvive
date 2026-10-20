import type { WorldObstacle } from './world-obstacle.ts';

export type TerrainKind = 'grass' | 'dirt' | 'gravel';

export type TerrainTile = {
    readonly xMeters: number;
    readonly yMeters: number;
    readonly kind: TerrainKind;
};

export type WorldChunkKey = {
    readonly seed: string;
    readonly generatorVersion: number;
    readonly chunkX: number;
    readonly chunkY: number;
};

export type WorldChunk = WorldChunkKey & {
    readonly minXMeters: number;
    readonly minYMeters: number;
    readonly sizeMeters: number;
    readonly tileSizeMeters: number;
    readonly terrain: readonly TerrainTile[];
    readonly obstacles: readonly WorldObstacle[];
};
