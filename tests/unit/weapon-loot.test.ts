import { worldGenerationSettings } from '@zombi-survive/content';
import type { ItemLocation } from '@zombi-survive/domain';
import { pickUpItem, transferWeapon } from '@zombi-survive/simulation';
import {
    generateWorldChunk,
    generateWorldWeaponLoot,
    initialWorldWeaponLoot,
    loadWorldChunks,
} from '@zombi-survive/worldgen';
import { expect, test } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';

for (const seed of ['zombi-survive', 'other-seed', '边界', 'a'.repeat(128)]) {
    test(`loot seed ${seed} has stable IDs and accessible positions across positive and negative chunks`, () => {
        const key = { seed, generatorVersion: 1, chunkX: 0, chunkY: 0 };
        const before = JSON.stringify(generateWorldChunk(key));
        const loot = generateWorldWeaponLoot(seed);
        expect(generateWorldWeaponLoot(seed)).toEqual(loot);
        expect(new Set(loot.map(item => item.itemId)).size).toBe(4);
        expect(new Set(loot.map(item => item.kind))).toEqual(
            new Set(['club', 'knife', 'crowbar', 'axe']),
        );
        expect(JSON.stringify(generateWorldChunk(key))).toBe(before);
        for (const item of loot) {
            const chunks = loadWorldChunks({ positions: [item.position], previousChunks: [] });
            const player = {
                playerId: 'solo',
                position: item.position,
                stamina: 1,
                isExhausted: false,
                isSneaking: false,
                noiseRadiusMeters: 0,
            };
            const ground: ItemLocation = { type: 'ground', item };
            const obstacles = chunks.flatMap(chunk => chunk.obstacles);
            expect(
                pickUpItem({ location: ground, player, itemId: item.itemId, obstacles }).type,
            ).toBe('container');
            const wall = {
                id: 'wall',
                minXMeters: item.position.xMeters + 0.5,
                maxXMeters: item.position.xMeters + 0.6,
                minYMeters: item.position.yMeters - 2,
                maxYMeters: item.position.yMeters + 2,
            };
            expect(
                pickUpItem({
                    location: ground,
                    player: {
                        ...player,
                        position: { ...item.position, xMeters: item.position.xMeters + 1.4 },
                    },
                    itemId: item.itemId,
                    obstacles: [wall],
                }),
            ).toBe(ground);
            expect(
                pickUpItem({
                    location: ground,
                    player: {
                        ...player,
                        position: { ...item.position, xMeters: item.position.xMeters + 1.501 },
                    },
                    itemId: item.itemId,
                    obstacles,
                }),
            ).toBe(ground);
        }
    });
}

test('loot overlay rejects unsupported seeds and leaves terrain generator version at v1', () => {
    expect(() => generateWorldWeaponLoot('')).toThrow();
    expect(() => generateWorldWeaponLoot('x'.repeat(129))).toThrow();
    expect(worldGenerationSettings.generatorVersion).toBe(1);
});

test('non-origin pickup uses translated world geometry, stages once across tabs and equips the exact instance', () => {
    const loot = initialWorldWeaponLoot.find(item => item.kind === 'axe');
    if (loot === undefined) throw new Error('Missing axe.');
    const movement = new LocalWorldMovement('world', 'solo', loot.position);
    movement.join('first');
    movement.join('tab');
    const sessions = new Map(['first', 'tab'].map(id => [id, movement.snapshot(id)]));
    const pickup = new LocalWorldPickup(
        initialWorldWeaponLoot.map(item => ({ type: 'ground', item })),
    );
    const read = () => pickup.snapshot(movement.snapshot('first'));
    expect(read().groundItem).toEqual(loot);
    const command = { type: 'pickup-item', protocolVersion: 5, itemId: loot.itemId };
    pickup.receive('first', command);
    pickup.receive('tab', command);
    pickup.step(sessions);
    expect(read().items).toEqual([]);
    const pending = pickup.takePendingSave();
    expect(pending?.filter(location => location.type === 'container')).toHaveLength(1);
    pickup.confirmSave();
    pickup.step(sessions);
    expect(read().groundItem).toBeNull();
    expect(read().items).toMatchObject([{ itemId: loot.itemId }]);
    pickup.receive('tab', command);
    pickup.step(sessions);
    expect(pickup.takePendingSave()).toBeNull();
    const locations = transferWeapon({
        locations: pending ?? [],
        playerId: 'solo',
        itemId: loot.itemId,
        type: 'equip-weapon',
    });
    expect(locations.filter(location => location.type === 'hands')).toEqual([
        { type: 'hands', playerId: 'solo', item: { itemId: loot.itemId, kind: 'axe' } },
    ]);
});

test('weight and full grid refusals preserve the ground weapon without mutation', () => {
    const item = initialWorldWeaponLoot[0];
    if (item === undefined) throw new Error('Missing loot.');
    const location: ItemLocation = { type: 'ground', item };
    const player = {
        playerId: 'solo',
        position: item.position,
        stamina: 1,
        isExhausted: false,
        isSneaking: false,
        noiseRadiusMeters: 0,
    };
    const full = Array.from({ length: 12 }, (_, index) => ({
        itemId: `knife-${String(index)}`,
        kind: 'knife' as const,
        cell: { column: index % 4, row: Math.floor(index / 4) },
    }));
    const heavy = (['axe', 'axe', 'club'] as const).map((kind, index) => ({
        itemId: `heavy-${String(index)}`,
        kind,
        cell: { column: index, row: 0 },
    }));
    for (const items of [full, heavy])
        expect(pickUpItem({ location, player, itemId: item.itemId, obstacles: [], items })).toBe(
            location,
        );
});

test.each([-64, 64])('pickup respects generated walls translated by %s meters', offset => {
    const item = {
        itemId: 'wall-weapon',
        kind: 'knife' as const,
        position: { xMeters: offset + 6, yMeters: 0 },
    };
    const movement = new LocalWorldMovement('world', 'solo', { xMeters: offset + 4.6, yMeters: 0 });
    movement.join('session');
    const pickup = new LocalWorldPickup([{ type: 'ground', item }]);
    pickup.receive('session', { type: 'pickup-item', protocolVersion: 5, itemId: item.itemId });
    pickup.step(new Map([['session', movement.snapshot('session')]]));
    expect(pickup.takePendingSave()).toBeNull();
    expect(pickup.snapshot(movement.snapshot('session')).groundItem).toEqual(item);
});
