import { startingRuins, worldGenerationSettings } from '@zombi-survive/content';
import type {
    TerrainKind,
    TerrainTile,
    WorldChunk,
    WorldChunkKey,
    WorldObstacle,
} from '@zombi-survive/domain';

// FNV-1a on UTF-16 code units. Separate channels keep terrain and geometry independent.
const hash = (value: string): number => {
    let result = 2166136261;

    for (let index = 0; index < value.length; index++) {
        result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    }

    return result >>> 0;
};

const validateKey = (key: WorldChunkKey): void => {
    const isValidSeed = key.seed.length > 0 && key.seed.length <= 128;
    const isSupportedVersion = key.generatorVersion === worldGenerationSettings.generatorVersion;
    const isCoordinate = (value: number): boolean =>
        Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000;
    const isValidCoordinates = isCoordinate(key.chunkX) && isCoordinate(key.chunkY);

    if (!isValidSeed || !isSupportedVersion || !isValidCoordinates) {
        throw new RangeError('Unsupported world chunk key.');
    }
};

const terrainKind = (value: number): TerrainKind => {
    if (value % 16 < 3) {
        return 'dirt';
    }

    return value % 16 === 3 ? 'gravel' : 'grass';
};

/** Generate one immutable chunk without runtime APIs, shared state or generation-order effects. */
export const generateWorldChunk = (key: WorldChunkKey): WorldChunk => {
    validateKey(key);
    const {
        chunkSizeMeters: sizeMeters,
        tileSizeMeters,
        edgeClearanceMeters,
        scatterCellSizeMeters,
        centralClearanceMeters,
    } = worldGenerationSettings;
    const minXMeters = key.chunkX * sizeMeters - sizeMeters / 2;
    const minYMeters = key.chunkY * sizeMeters - sizeMeters / 2;
    const identity = JSON.stringify([key.generatorVersion, key.seed, key.chunkX, key.chunkY]);
    const prefix = `v${String(key.generatorVersion)}:${String(key.chunkX)}:${String(key.chunkY)}`;
    const terrain: TerrainTile[] = [];
    const obstacles: WorldObstacle[] = startingRuins.map(ruin =>
        Object.freeze({
            ...ruin,
            id: `${prefix}:${ruin.id}`,
            minXMeters: key.chunkX * sizeMeters + ruin.minXMeters,
            maxXMeters: key.chunkX * sizeMeters + ruin.maxXMeters,
            minYMeters: key.chunkY * sizeMeters + ruin.minYMeters,
            maxYMeters: key.chunkY * sizeMeters + ruin.maxYMeters,
        }),
    );

    for (let y = 0; y < sizeMeters; y += tileSizeMeters) {
        for (let x = 0; x < sizeMeters; x += tileSizeMeters) {
            // A shared grass verge and no geometry at the seam, including negative coordinates.
            const isEdge =
                x < edgeClearanceMeters ||
                y < edgeClearanceMeters ||
                x >= sizeMeters - edgeClearanceMeters ||
                y >= sizeMeters - edgeClearanceMeters;
            terrain.push(
                Object.freeze({
                    xMeters: minXMeters + x,
                    yMeters: minYMeters + y,
                    kind: isEdge
                        ? 'grass'
                        : terrainKind(hash(`${identity}:terrain:${String(x)}:${String(y)}`)),
                }),
            );
        }
    }

    for (let y = scatterCellSizeMeters / 2; y < sizeMeters; y += scatterCellSizeMeters) {
        for (let x = scatterCellSizeMeters / 2; x < sizeMeters; x += scatterCellSizeMeters) {
            const isOutsideStartingArea =
                Math.abs(x - sizeMeters / 2) >= centralClearanceMeters &&
                Math.abs(y - sizeMeters / 2) >= centralClearanceMeters;

            if (!isOutsideStartingArea) {
                continue;
            }

            const value = hash(`${identity}:rock:${String(x)}:${String(y)}`);
            const width = 1 + (value % 3);
            const height = 1 + ((value >>> 4) % 3);
            const left = minXMeters + x - width / 2;
            const top = minYMeters + y - height / 2;
            obstacles.push(
                Object.freeze({
                    id: `${prefix}:rock:${String(x)}:${String(y)}`,
                    minXMeters: left,
                    minYMeters: top,
                    maxXMeters: left + width,
                    maxYMeters: top + height,
                }),
            );
        }
    }

    return Object.freeze({
        ...key,
        minXMeters,
        minYMeters,
        sizeMeters,
        tileSizeMeters,
        terrain: Object.freeze(terrain),
        obstacles: Object.freeze(obstacles),
    });
};
