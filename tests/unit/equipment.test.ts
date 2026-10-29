import { initialGroundItem } from '@zombi-survive/content';
import type { ItemLocation } from '@zombi-survive/domain';
import {
    addStarterWeapons,
    playerHands,
    playerInventory,
    transferWeapon,
} from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const starter = () => addStarterWeapons([{ type: 'ground', item: initialGroundItem }], 'solo');
const transfer = (
    locations: readonly ItemLocation[],
    itemId = 'solo:axe',
    type: 'equip-weapon' | 'unequip-weapon' = 'equip-weapon',
    playerId = 'solo',
) => transferWeapon({ locations, playerId, itemId, type });

test('migration preserves any existing bandage cell and all five unique instances fit the original grid', () => {
    for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
            const bandage: ItemLocation = {
                type: 'container',
                playerId: 'solo',
                item: initialGroundItem,
                cell: { column, row },
            };
            const locations = addStarterWeapons([bandage], 'solo');
            expect(locations[0]).toEqual(bandage);
            expect(new Set(locations.map(location => location.item.itemId)).size).toBe(5);
            expect(playerInventory(locations, 'solo')).toHaveLength(5);
            expect(playerHands(locations, 'solo')).toBeNull();
        }
    }
});

test('equip, swap, move back and replay retain each original instance exactly once', () => {
    const initial = starter();
    const equipped = transfer(initial);
    expect(playerHands(equipped, 'solo')).toEqual({ itemId: 'solo:axe', kind: 'axe' });
    expect(playerInventory(equipped, 'solo')).toHaveLength(3);
    expect(transfer(equipped)).toBe(equipped);
    const swapped = transfer(equipped, 'solo:knife');
    expect(playerHands(swapped, 'solo')?.itemId).toBe('solo:knife');
    expect(playerInventory(swapped, 'solo').some(item => item.itemId === 'solo:axe')).toBe(true);
    const removed = transfer(swapped, 'solo:knife', 'unequip-weapon');
    expect(playerHands(removed, 'solo')).toBeNull();
    expect(transfer(removed, 'solo:knife', 'unequip-weapon')).toBe(removed);
    expect(removed.map(location => location.item.itemId).sort()).toEqual(
        initial.map(location => location.item.itemId).sort(),
    );
    expect(playerInventory(initial, 'solo')).toHaveLength(4);
});

test('foreign ownership, wrong item, forged ID and stale unequip never transfer items', () => {
    const collected: ItemLocation = {
        type: 'container',
        playerId: 'solo',
        item: initialGroundItem,
        cell: { column: 0, row: 0 },
    };
    const initial = addStarterWeapons([collected], 'solo');
    expect(transfer(initial, 'solo:axe', 'equip-weapon', 'other')).toBe(initial);
    expect(transfer(initial, 'starter-bandage')).toBe(initial);
    expect(transfer(initial, 'missing')).toBe(initial);
    const equipped = transfer(initial);
    expect(transfer(equipped, 'solo:knife', 'unequip-weapon')).toBe(equipped);
});

test('a full grid rejects unequip atomically, but a swap can reuse the departing item cell', () => {
    const grid: ItemLocation[] = Array.from({ length: 6 }, (_, index) => ({
        type: 'container',
        playerId: 'solo',
        item: { itemId: `bandage-${String(index)}`, kind: 'bandage' },
        cell: { column: (index % 2) * 2, row: Math.floor(index / 2) },
    }));
    const locations: readonly ItemLocation[] = [
        ...grid,
        { type: 'hands', playerId: 'solo', item: { itemId: 'solo:knife', kind: 'knife' } },
    ];
    expect(transfer(locations, 'solo:knife', 'unequip-weapon')).toBe(locations);
    const packed: readonly ItemLocation[] = [
        ...grid.slice(0, 5),
        {
            type: 'container',
            playerId: 'solo',
            item: { itemId: 'solo:club', kind: 'club' },
            cell: { column: 2, row: 2 },
        },
        {
            type: 'container',
            playerId: 'solo',
            item: { itemId: 'extra', kind: 'knife' },
            cell: { column: 3, row: 2 },
        },
        { type: 'hands', playerId: 'solo', item: { itemId: 'solo:knife', kind: 'knife' } },
    ];
    const swapped = transfer(packed, 'solo:club');
    expect(playerHands(swapped, 'solo')?.itemId).toBe('solo:club');
    expect(
        playerInventory(swapped, 'solo').find(item => item.itemId === 'solo:knife')?.cell,
    ).toEqual({ column: 2, row: 2 });
});
