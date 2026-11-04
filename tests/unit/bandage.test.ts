import type { ItemLocation } from '@zombi-survive/domain';
import { inventoryVersion, isUseBandageCommand, protocolVersion } from '@zombi-survive/protocol';
import { stepBleeding, useBandage } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const locations: readonly ItemLocation[] = [
    {
        type: 'container',
        playerId: 'solo',
        item: { itemId: 'b1', kind: 'bandage' },
        cell: { column: 0, row: 0 },
    },
    {
        type: 'container',
        playerId: 'solo',
        item: { itemId: 'b2', kind: 'bandage' },
        cell: { column: 0, row: 1 },
    },
];
const player = { playerId: 'solo', health: 1, bleedingTicks: 1 };

test('a concrete bandage stops the last bleeding tick without healing or mutating its inputs', () => {
    const result = useBandage({ locations, player, itemId: 'b1' });
    expect(stepBleeding(result.player)).toEqual({ ...player, bleedingTicks: 0 });
    expect(result.locations).toEqual([locations[1]]);
    expect(locations).toHaveLength(2);
    expect(player.bleedingTicks).toBe(1);
    const duplicate = useBandage({ ...result, itemId: 'b1' });
    expect(duplicate).toEqual(result);
    // A delayed duplicate cannot consume another item, even after a new wound.
    expect(useBandage({ ...result, player, itemId: 'b1' }).locations).toBe(result.locations);
});

test.each([
    { player: { ...player, health: 0 }, itemId: 'b1' },
    { player: { ...player, bleedingTicks: 0 }, itemId: 'b1' },
    { player: { ...player, playerId: 'foreign' }, itemId: 'b1' },
    { player, itemId: 'missing' },
])('invalid bandage use leaves the item and wound untouched: %j', input => {
    expect(useBandage({ locations, ...input })).toEqual({ locations, player: input.player });
});

test('ground items and weapons cannot be used as bandages', () => {
    const ground: ItemLocation = {
        type: 'ground',
        item: { itemId: 'g', kind: 'bandage', position: { xMeters: 0, yMeters: 0 } },
    };
    const weapon: ItemLocation = {
        type: 'container',
        playerId: 'solo',
        item: { itemId: 'w', kind: 'knife' },
        cell: { column: 0, row: 0 },
    };
    for (const location of [ground, weapon]) {
        const input = [location];
        expect(
            useBandage({ locations: input, player, itemId: location.item.itemId }).locations,
        ).toBe(input);
    }
});

test('bandage command validates concrete ID and both versions at the network boundary', () => {
    const command = { type: 'use-bandage', itemId: 'b1', protocolVersion, inventoryVersion };
    expect(isUseBandageCommand(JSON.parse(JSON.stringify(command)))).toBe(true);
    for (const value of [
        null,
        [],
        {},
        { ...command, type: 'pickup-item' },
        { ...command, itemId: '' },
        { ...command, itemId: ' b1' },
        { ...command, itemId: 'x'.repeat(129) },
        { ...command, protocolVersion: 4 },
        { ...command, inventoryVersion: 1 },
    ]) {
        expect(isUseBandageCommand(value)).toBe(false);
    }
});
