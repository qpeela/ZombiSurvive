import { worldGenerationSettings } from '@zombi-survive/content';
import type { GroundItem } from '@zombi-survive/domain';
import { generateChunkLoot } from '@zombi-survive/worldgen';

const invalid = (): never => {
    throw new Error('Solo save contains an invalid chunk loot registry.');
};

export const chunkLootForKey = (key: string, includeBandages = true): readonly GroundItem[] => {
    const coordinates = key.split(',');
    const chunkX = Number(coordinates[0]);
    const chunkY = Number(coordinates[1]);
    const isCanonical = key === `${String(chunkX)},${String(chunkY)}`;
    if (!isCanonical || coordinates.length !== 2) return invalid();

    const loot = generateChunkLoot({
        seed: worldGenerationSettings.initialSeed,
        generatorVersion: worldGenerationSettings.generatorVersion,
        chunkX,
        chunkY,
    });
    if (loot.length === 0) return invalid();

    return includeBandages ? loot : loot.filter(item => item.kind !== 'bandage');
};

export const chunkLootKeyFromItemId = (itemId: string): string | null => {
    if (!itemId.startsWith('chunk-loot-v1:')) return null;
    const match = /^chunk-loot-v1:(-?\d+):(-?\d+):(weapon|ammo|bandage)$/.exec(itemId);
    if (match === null) return invalid();
    const key = `${match[1] ?? ''},${match[2] ?? ''}`;
    if (key !== `${String(Number(match[1]))},${String(Number(match[2]))}`) return invalid();

    return key;
};

/** Independent expected keys detect lost item records instead of regenerating them. */
export const readSavedLootChunks = (value: unknown): readonly string[] => {
    if (typeof value !== 'string') return invalid();
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return invalid();
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const key of parsed as unknown[]) {
        if (typeof key !== 'string' || key.length > 32 || seen.has(key)) return invalid();
        chunkLootForKey(key);
        seen.add(key);
        keys.push(key);
    }

    return keys;
};
