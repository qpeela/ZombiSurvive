import type { Item, ItemLocation, PistolItem } from '@zombi-survive/domain';
import {
    equipmentWeightGrams,
    playerHands,
    playerInventory,
    reloadPistol,
    spendPistolRound,
    transferWeapon,
    useBandage,
} from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const pistol: PistolItem = { itemId: 'pistol', kind: 'pistol', rounds: 3, magazineCapacity: 8 };
const items: readonly Item[] = [
    { itemId: 'pack', kind: 'ammo9mm', quantity: 8 },
    { itemId: 'bandage', kind: 'bandage' },
];

test('total mass counts bags, hands, partial packs and every loaded round', () => {
    expect(equipmentWeightGrams({ items, hands: pistol })).toBe(1032);
    expect(equipmentWeightGrams({ items: [...items, pistol], hands: null })).toBe(1032);
    expect(equipmentWeightGrams({ items: [], hands: null })).toBe(0);
    expect(equipmentWeightGrams({ items: [], hands: { ...pistol, rounds: 0 } })).toBe(800);
});

test('equip and unequip preserve total mass across the real transfer rules', () => {
    const locations: readonly ItemLocation[] = [
        { type: 'container', playerId: 'solo', item: pistol, cell: { column: 0, row: 0 } },
        { type: 'hands', playerId: 'solo', item: { itemId: 'knife', kind: 'knife' } },
    ];
    const weigh = (state: readonly ItemLocation[]) =>
        equipmentWeightGrams({
            items: playerInventory(state, 'solo'),
            hands: playerHands(state, 'solo'),
        });
    const equipped = transferWeapon({
        locations,
        playerId: 'solo',
        itemId: 'pistol',
        type: 'equip-weapon',
    });
    const unequipped = transferWeapon({
        locations: equipped,
        playerId: 'solo',
        itemId: 'pistol',
        type: 'unequip-weapon',
    });
    expect(weigh(locations)).toBe(936);
    expect(weigh(equipped)).toBe(936);
    expect(weigh(unequipped)).toBe(936);
});

test('an accepted shot removes one round of mass and rejected retries spend nothing', () => {
    const shot = spendPistolRound(pistol, 0);
    expect(shot).not.toBeNull();
    expect(equipmentWeightGrams({ items, hands: shot })).toBe(1020);
    expect(shot === null ? null : spendPistolRound(shot, 0)).toBeNull();
});

test('consuming one concrete bandage reduces carried mass by 100 grams', () => {
    const locations: readonly ItemLocation[] = [
        {
            type: 'container',
            playerId: 'solo',
            item: { itemId: 'bandage', kind: 'bandage' },
            cell: { column: 0, row: 0 },
        },
    ];
    const result = useBandage({
        locations,
        player: { playerId: 'solo', health: 90, bleedingTicks: 1 },
        itemId: 'bandage',
    });
    expect(equipmentWeightGrams({ items: playerInventory(locations, 'solo'), hands: pistol })).toBe(
        936,
    );
    expect(
        equipmentWeightGrams({ items: playerInventory(result.locations, 'solo'), hands: pistol }),
    ).toBe(836);
});

test('reloading a partial magazine conserves mass while a remaining pack stays distinct', () => {
    const locations: readonly ItemLocation[] = [
        { type: 'hands', playerId: 'solo', item: pistol },
        {
            type: 'container',
            playerId: 'solo',
            item: { itemId: 'pack', kind: 'ammo9mm', quantity: 8 },
            cell: { column: 0, row: 0 },
        },
    ];
    const reloaded = reloadPistol({ locations, playerId: 'solo', itemId: 'pistol', revision: 0 });
    expect(playerHands(reloaded, 'solo')).toMatchObject({ rounds: 8 });
    expect(playerInventory(reloaded, 'solo')[0]).toMatchObject({ quantity: 3 });
    for (const state of [locations, reloaded]) {
        expect(
            equipmentWeightGrams({
                items: playerInventory(state, 'solo'),
                hands: playerHands(state, 'solo'),
            }),
        ).toBe(932);
    }
});
