import { initialGroundItem } from '@zombi-survive/content';
import {
    isPickupCommand,
    isPickupSnapshot,
    type PickupSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

const state: PickupSnapshot = {
    type: 'pickup-state',
    protocolVersion,
    worldId: 'world',
    playerId: 'player',
    tick: 0,
    groundItem: initialGroundItem,
    items: [],
};
test('pickup command accepts an ID intent and rejects malformed or incompatible messages', () => {
    const command = { type: 'pickup-item', protocolVersion, itemId: 'item' };
    expect(isPickupCommand(JSON.parse(JSON.stringify(command)))).toBe(true);
    for (const value of [
        null,
        [],
        {},
        { ...command, itemId: '' },
        { ...command, itemId: ' item ' },
        { ...command, itemId: 'x'.repeat(129) },
        { ...command, protocolVersion: 4 },
        { ...command, type: 'movement-input' },
    ]) {
        expect(isPickupCommand(value)).toBe(false);
    }
});
test('pickup states validate identity, tick, item kind, coordinates and single-item ownership', () => {
    expect(isPickupSnapshot(JSON.parse(JSON.stringify(state)))).toBe(true);
    const item = { itemId: 'item', kind: 'bandage' };
    expect(isPickupSnapshot({ ...state, groundItem: null, items: [item] })).toBe(true);
    expect(isPickupSnapshot({ ...state, groundItem: null })).toBe(true);
    for (const value of [
        null,
        {},
        { ...state, protocolVersion: 4 },
        { ...state, worldId: '' },
        { ...state, playerId: ' player' },
        { ...state, tick: -1 },
        { ...state, tick: 0.5 },
        { ...state, tick: Infinity },
        { ...state, items: [item] },
        { ...state, groundItem: null, items: [item, item] },
        { ...state, items: [{}] },
        { ...state, groundItem: { ...initialGroundItem, kind: 'unknown' } },
        { ...state, groundItem: { ...initialGroundItem, position: { xMeters: NaN, yMeters: 0 } } },
        { ...state, groundItem: item },
    ]) {
        expect(isPickupSnapshot(value)).toBe(false);
    }
});
