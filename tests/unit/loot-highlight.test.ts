import { describe, expect, it } from 'vitest';

import { isLootInViewport } from '../../apps/client/src/loot-highlight.ts';

describe('loot highlight viewport', () => {
    const position = { x: 400, y: 300 };
    const camera = { scrollX: 100, scrollY: 50, width: 600, height: 400 };

    it('stops including the same source when the camera scrolls past it', () => {
        expect(isLootInViewport(position, camera)).toBe(true);
        expect(isLootInViewport(position, { ...camera, scrollY: 301 })).toBe(false);
        expect(isLootInViewport(position, { ...camera, scrollX: 401 })).toBe(false);
    });

    it('includes the top and left edges and excludes positions beyond the far edges', () => {
        expect(isLootInViewport({ x: 100, y: 50 }, camera)).toBe(true);
        expect(isLootInViewport({ x: 700, y: 50 }, camera)).toBe(false);
        expect(isLootInViewport({ x: 100, y: 450 }, camera)).toBe(false);
    });
});
