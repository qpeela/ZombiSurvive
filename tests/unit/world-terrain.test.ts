import type { Scene } from 'phaser';
import { expect, test } from 'vitest';

import { WorldTerrain } from '../../apps/client/src/world-terrain.ts';

test('cleanup remains idempotent after Phaser has shut down its CameraManager', () => {
    const dataset: Record<string, string> = {};
    // Only the canvas survives shutdown. Accessing cameras here reproduces the lifecycle failure.
    const stoppedScene = {
        game: { canvas: { dataset } },
        get cameras(): never {
            throw new Error('CameraManager already shut down.');
        },
    } as unknown as Scene;
    const terrain = new WorldTerrain(stoppedScene);

    expect(() => {
        terrain.destroy();
    }).not.toThrow();
    expect(() => {
        terrain.destroy();
    }).not.toThrow();
    expect(dataset['visibleWorldChunkCount']).toBe('0');
});
