import { worldGenerationSettings } from '@zombi-survive/content';
import type { WorldChunk, WorldChunkKey, WorldPosition } from '@zombi-survive/domain';

import { generateWorldChunk } from './chunk.ts';

const chunkId = (key: WorldChunkKey): string => `${String(key.chunkX)},${String(key.chunkY)}`;

/** Pure, bounded neighbourhood update. The caller owns the returned cache; no global state or IO. */
export const loadWorldChunks = ({
    positions,
    previousChunks,
}: {
    readonly positions: readonly WorldPosition[];
    readonly previousChunks: readonly WorldChunk[];
}): readonly WorldChunk[] => {
    const { chunkSizeMeters, initialSeed: seed, generatorVersion } = worldGenerationSettings;
    const required = new Map<string, WorldChunkKey>();

    for (const position of positions) {
        const chunkX = Math.floor((position.xMeters + chunkSizeMeters / 2) / chunkSizeMeters);
        const chunkY = Math.floor((position.yMeters + chunkSizeMeters / 2) / chunkSizeMeters);
        const isValidCoordinate = (value: number): boolean =>
            Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000;

        if (!isValidCoordinate(chunkX) || !isValidCoordinate(chunkY)) {
            throw new RangeError('Position is outside the supported world.');
        }

        // One chunk of lookahead covers the viewport, footprint and 500 ms prediction horizon.
        for (let y = chunkY - 1; y <= chunkY + 1; y++) {
            for (let x = chunkX - 1; x <= chunkX + 1; x++) {
                if (!isValidCoordinate(x) || !isValidCoordinate(y)) {
                    continue;
                }

                const key = { seed, generatorVersion, chunkX: x, chunkY: y };
                required.set(chunkId(key), key);
            }
        }
    }

    const available = new Map(
        previousChunks
            .filter(chunk => chunk.seed === seed && chunk.generatorVersion === generatorVersion)
            .map(chunk => [chunkId(chunk), chunk]),
    );
    const isUnchanged =
        required.size === previousChunks.length &&
        [...required.keys()].every(id => available.has(id));

    if (isUnchanged) {
        return previousChunks;
    }

    return Object.freeze(
        [...required].map(([id, key]) => available.get(id) ?? generateWorldChunk(key)),
    );
};
