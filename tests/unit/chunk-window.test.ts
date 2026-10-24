import type { WorldChunk, WorldPosition } from '@zombi-survive/domain';
import { generateWorldChunk, initialWorldChunk, loadWorldChunks } from '@zombi-survive/worldgen';
import { expect, test } from 'vitest';

const origin = { xMeters: 0, yMeters: 0 };
const load = (position: WorldPosition, previousChunks: readonly WorldChunk[] = []) =>
    loadWorldChunks({ positions: [position], previousChunks });

test.each([
    [31.999, 0, 0, 0],
    [32, 0, 1, 0],
    [-32, 0, 0, 0],
    [-32.001, 0, -1, 0],
    [0, 32, 0, 1],
    [0, -32, 0, 0],
    [0, -32.001, 0, -1],
    [-32.001, 32, -1, 1],
])('position (%s, %s) loads the complete 3x3 window at (%s, %s)', (x, y, centerX, centerY) => {
    const chunks = load({ xMeters: x, yMeters: y });
    expect(chunks).toHaveLength(9);
    expect(
        new Set(chunks.map(chunk => `${String(chunk.chunkX)},${String(chunk.chunkY)}`)).size,
    ).toBe(9);
    expect(chunks.map(chunk => chunk.chunkX).sort()).toEqual(
        [
            centerX - 1,
            centerX - 1,
            centerX - 1,
            centerX,
            centerX,
            centerX,
            centerX + 1,
            centerX + 1,
            centerX + 1,
        ].sort(),
    );
    expect(chunks.map(chunk => chunk.chunkY).sort()).toEqual(
        [
            centerY - 1,
            centerY - 1,
            centerY - 1,
            centerY,
            centerY,
            centerY,
            centerY + 1,
            centerY + 1,
            centerY + 1,
        ].sort(),
    );
});

test('retains shared chunks, does no generation within the same cell and releases old references', () => {
    const initial = load(origin);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(load({ xMeters: 31, yMeters: -31 }, initial)).toBe(initial);
    const east = load({ xMeters: 32, yMeters: 0 }, initial);
    expect(east).toHaveLength(9);
    expect(east.filter(chunk => initial.includes(chunk))).toHaveLength(6);
    expect(east.every(chunk => chunk.chunkX >= 0)).toBe(true);
    let chunks = east;

    for (let index = 2; index <= 30; index++) {
        chunks = load({ xMeters: index * 64, yMeters: -index * 64 }, chunks);
        expect(chunks).toHaveLength(9);
    }

    expect(chunks.some(chunk => initial.includes(chunk))).toBe(false);
    const returned = load(origin, chunks);
    expect(returned).toEqual(initial);
    expect(returned.some(chunk => initial.includes(chunk))).toBe(false);
    expect(loadWorldChunks({ positions: [], previousChunks: returned })).toEqual([]);
    expect(load(origin)).toEqual(returned);
});

test('multiple centres share overlaps and remain bounded by nine chunks per player', () => {
    const shared = loadWorldChunks({
        positions: [origin, origin, { xMeters: 64, yMeters: 0 }],
        previousChunks: [],
    });
    expect(shared).toHaveLength(12);
    const positions = Array.from({ length: 8 }, (_, index) => ({
        xMeters: index * 256,
        yMeters: index * -256,
    }));
    const separated = loadWorldChunks({ positions, previousChunks: shared });
    expect(separated).toHaveLength(72);
    expect(
        loadWorldChunks({ positions: [...positions].reverse(), previousChunks: separated }),
    ).toBe(separated);
    expect(load(origin, separated)).toHaveLength(9);
});

test('foreign cached world keys cannot replace geometry of the fixed manifest', () => {
    const chunks = load(origin);
    const foreign = chunks.map(chunk => generateWorldChunk({ ...chunk, seed: 'another-world' }));
    expect(load(origin, foreign)).toEqual(chunks);
    expect(load(origin, foreign).some(chunk => foreign.includes(chunk))).toBe(false);
});

test.each([NaN, Infinity, -Infinity, 64_000_100, -64_000_100])(
    'unsupported position %s fails before changing the caller cache',
    coordinate => {
        const chunks = load(origin);
        expect(() => load({ xMeters: coordinate, yMeters: 0 }, chunks)).toThrow(RangeError);
        expect(() => load({ xMeters: 0, yMeters: coordinate }, chunks)).toThrow(RangeError);
        expect(chunks.find(chunk => chunk.chunkX === 0 && chunk.chunkY === 0)).toEqual(
            initialWorldChunk,
        );
    },
);
