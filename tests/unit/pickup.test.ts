import { initialGroundItem, pickupSettings } from '@zombi-survive/content';
import type { ItemLocation, PlayerMovementState } from '@zombi-survive/domain';
import { pickUpItem } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const ground: ItemLocation = { type: 'ground', item: initialGroundItem };
const player: PlayerMovementState = {
    playerId: 'player',
    position: { xMeters: 2, yMeters: 2 },
    stamina: 1,
    isExhausted: false,
    isSneaking: false,
    noiseRadiusMeters: 0,
};
const itemId = initialGroundItem.itemId;

test('pickup is one immutable transfer; duplicates and another player cannot acquire it', () => {
    const location = pickUpItem({ location: ground, player, itemId, obstacles: [] });
    expect(location).toEqual({
        type: 'container',
        item: { itemId, kind: 'bandage' },
        playerId: 'player',
    });
    expect(ground).toEqual({ type: 'ground', item: initialGroundItem });
    expect(pickUpItem({ location, player, itemId, obstacles: [] })).toBe(location);
    expect(
        pickUpItem({ location, player: { ...player, playerId: 'other' }, itemId, obstacles: [] }),
    ).toBe(location);
});

test('unknown IDs, distant and non-finite positions cannot pick up the item', () => {
    expect(pickUpItem({ location: ground, player, itemId: 'missing', obstacles: [] })).toBe(ground);
    for (const xMeters of [2 + pickupSettings.rangeMeters + 0.001, NaN, Infinity]) {
        expect(
            pickUpItem({
                location: ground,
                player: { ...player, position: { xMeters, yMeters: 2 } },
                itemId,
                obstacles: [],
            }),
        ).toBe(ground);
    }
    const boundary = {
        ...player,
        position: { xMeters: 2 + pickupSettings.rangeMeters, yMeters: 2 },
    };
    expect(pickUpItem({ location: ground, player: boundary, itemId, obstacles: [] }).type).toBe(
        'container',
    );
});

test('nearby items cannot be taken through an obstacle', () => {
    const blocked = { ...player, position: { xMeters: 3.4, yMeters: 2 } };
    const obstacles = [
        { id: 'wall', minXMeters: 2.5, maxXMeters: 2.6, minYMeters: 0, maxYMeters: 4 },
    ];
    expect(pickUpItem({ location: ground, player: blocked, itemId, obstacles })).toBe(ground);
});
