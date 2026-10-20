import { collisionSettings } from '@zombi-survive/content';
import type { WorldChunk, WorldChunkKey } from '@zombi-survive/domain';
import { resolveMovement } from '@zombi-survive/simulation';
import { generateWorldChunk, initialWorldChunk } from '@zombi-survive/worldgen';
import { expect, test } from 'vitest';

import {
    createMovementInput,
    createMovementTarget,
} from '../../apps/client/src/movement-contract.ts';
import { MovementPrediction } from '../../apps/client/src/movement-prediction.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';

const key: WorldChunkKey = { seed: 'test-seed', generatorVersion: 1, chunkX: 0, chunkY: 0 };
const edge = (chunk: WorldChunk, axis: 'x' | 'y', isEnd: boolean): readonly string[] => {
    const start = axis === 'x' ? chunk.minXMeters : chunk.minYMeters;
    const coordinate = start + (isEnd ? chunk.sizeMeters - chunk.tileSizeMeters : 0);

    return chunk.terrain
        .filter(tile => (axis === 'x' ? tile.xMeters : tile.yMeters) === coordinate)
        .map(tile => tile.kind);
};

test('seed, coordinates and version reproduce detached geometry regardless of request order', () => {
    const first = generateWorldChunk(key);
    generateWorldChunk({ ...key, chunkX: -1, chunkY: 3 });
    const second = generateWorldChunk({ ...key });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).not.toBe(first);
    expect(second.obstacles[0]).not.toBe(first.obstacles[0]);
    expect(generateWorldChunk({ ...key, seed: 'another-seed' }).terrain).not.toEqual(first.terrain);
    expect(generateWorldChunk({ ...key, seed: 'another-seed' }).obstacles).not.toEqual(
        first.obstacles,
    );
    expect(generateWorldChunk({ ...key, chunkX: 1 }).terrain).not.toEqual(first.terrain);
});

test.each([-3, -1, 0, 1, 3])(
    'all neighbouring seams meet at coordinate %s with matching terrain and free geometry',
    coordinate => {
        const center = generateWorldChunk({ ...key, chunkX: coordinate, chunkY: coordinate });
        const east = generateWorldChunk({ ...key, chunkX: coordinate + 1, chunkY: coordinate });
        const south = generateWorldChunk({ ...key, chunkX: coordinate, chunkY: coordinate + 1 });
        expect(center.minXMeters + center.sizeMeters).toBe(east.minXMeters);
        expect(center.minYMeters + center.sizeMeters).toBe(south.minYMeters);
        expect(edge(center, 'x', true)).toEqual(edge(east, 'x', false));
        expect(edge(center, 'y', true)).toEqual(edge(south, 'y', false));
        const half = collisionSettings.playerHalfSizeMeters;
        const seamStart = { xMeters: east.minXMeters - half, yMeters: center.minYMeters + 1 };
        const seamEnd = { ...seamStart, xMeters: east.minXMeters + half };
        expect(
            resolveMovement(seamStart, seamEnd, [...center.obstacles, ...east.obstacles]),
        ).toEqual(seamEnd);
    },
);

test('chunks contain complete immutable terrain, bounded non-overlapping obstacles and globally unique IDs', () => {
    const ids = new Set<string>();
    for (let chunkX = -2; chunkX <= 2; chunkX++) {
        const chunk = generateWorldChunk({ ...key, chunkX });
        expect(chunk.terrain).toHaveLength((chunk.sizeMeters / chunk.tileSizeMeters) ** 2);
        expect(
            new Set(chunk.terrain.map(tile => `${String(tile.xMeters)},${String(tile.yMeters)}`))
                .size,
        ).toBe(chunk.terrain.length);
        expect(new Set(chunk.terrain.map(tile => tile.kind))).toEqual(
            new Set(['grass', 'dirt', 'gravel']),
        );
        expect(Object.isFrozen(chunk)).toBe(true);
        expect(Object.isFrozen(chunk.terrain)).toBe(true);
        expect(Object.isFrozen(chunk.obstacles)).toBe(true);
        for (const tile of chunk.terrain) {
            expect(Object.isFrozen(tile)).toBe(true);
            expect(tile.xMeters).toBeGreaterThanOrEqual(chunk.minXMeters);
            expect(tile.xMeters + chunk.tileSizeMeters).toBeLessThanOrEqual(
                chunk.minXMeters + chunk.sizeMeters,
            );
            expect(tile.yMeters).toBeGreaterThanOrEqual(chunk.minYMeters);
            expect(tile.yMeters + chunk.tileSizeMeters).toBeLessThanOrEqual(
                chunk.minYMeters + chunk.sizeMeters,
            );
        }
        for (const obstacle of chunk.obstacles) {
            expect(ids.has(obstacle.id)).toBe(false);
            ids.add(obstacle.id);
            expect(Object.isFrozen(obstacle)).toBe(true);
            expect(obstacle.minXMeters).toBeGreaterThanOrEqual(chunk.minXMeters + 2);
            expect(obstacle.minYMeters).toBeGreaterThanOrEqual(chunk.minYMeters + 2);
            expect(obstacle.maxXMeters).toBeLessThanOrEqual(
                chunk.minXMeters + chunk.sizeMeters - 2,
            );
            expect(obstacle.maxYMeters).toBeLessThanOrEqual(
                chunk.minYMeters + chunk.sizeMeters - 2,
            );
            expect(obstacle.maxXMeters).toBeGreaterThan(obstacle.minXMeters);
            expect(obstacle.maxYMeters).toBeGreaterThan(obstacle.minYMeters);
            expect(
                chunk.obstacles.some(
                    other =>
                        other !== obstacle &&
                        other.minXMeters < obstacle.maxXMeters &&
                        other.maxXMeters > obstacle.minXMeters &&
                        other.minYMeters < obstacle.maxYMeters &&
                        other.maxYMeters > obstacle.minYMeters,
                ),
            ).toBe(false);
        }
    }
});

test.each([
    { seed: '' },
    { seed: 'x'.repeat(129) },
    { generatorVersion: 0 },
    { generatorVersion: 2 },
    { chunkX: 0.5 },
    { chunkY: NaN },
    { chunkX: Infinity },
    { chunkY: 1_000_001 },
])('invalid or unsupported keys fail explicitly: %j', invalid => {
    expect(() => generateWorldChunk({ ...key, ...invalid })).toThrow(RangeError);
});

test('authority and prediction stop at a generated rock outside the starting ruins', () => {
    const rock = initialWorldChunk.obstacles.find(
        obstacle =>
            obstacle.id.includes(':rock:') && obstacle.minXMeters > 0 && obstacle.minYMeters < 0,
    );
    if (rock === undefined) throw new Error('Generated rock missing.');
    const movement = new LocalWorldMovement('world', 'player');
    movement.join('session');
    let sequence = 0;
    const yMeters = (rock.minYMeters + rock.maxYMeters) / 2;
    for (let tick = 0; tick < 150; tick++) {
        movement.receive('session', createMovementTarget(++sequence, { xMeters: 0, yMeters }));
        movement.step();
    }
    for (let tick = 0; tick < 150; tick++) {
        movement.receive('session', createMovementInput(++sequence, { x: 1, y: 0 }));
        movement.step();
    }
    const atRock = movement.snapshot('session');
    expect(atRock.player.position.yMeters).toBeCloseTo(yMeters, 8);
    const boundary = rock.minXMeters - collisionSettings.playerHalfSizeMeters;
    expect(atRock.player.position.xMeters).toBeCloseTo(boundary, 8);
    const prediction = new MovementPrediction();
    prediction.accept(atRock, 0);
    prediction.setIntent(
        { type: 'direction', direction: { x: 1, y: 0 }, isSprinting: false, isSneaking: false },
        0,
    );
    prediction.recordSent(createMovementInput(sequence + 1, { x: 1, y: 0 }), 0);
    expect(prediction.sample(500)?.position.xMeters).toBeCloseTo(boundary, 8);
});
