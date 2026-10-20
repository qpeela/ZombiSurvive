import { worldGenerationSettings } from '@zombi-survive/content';

import { generateWorldChunk } from './chunk.ts';

// T011 has one fixed world manifest. Streaming and negotiated world keys belong to T012.
export const initialWorldChunk = generateWorldChunk({
    seed: worldGenerationSettings.initialSeed,
    generatorVersion: worldGenerationSettings.generatorVersion,
    chunkX: 0,
    chunkY: 0,
});
