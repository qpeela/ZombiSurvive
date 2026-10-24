import { worldGenerationSettings } from '@zombi-survive/content';

import { generateWorldChunk } from './chunk.ts';

// The origin chunk remains a public reference for the fixed v1 world manifest.
export const initialWorldChunk = generateWorldChunk({
    seed: worldGenerationSettings.initialSeed,
    generatorVersion: worldGenerationSettings.generatorVersion,
    chunkX: 0,
    chunkY: 0,
});
