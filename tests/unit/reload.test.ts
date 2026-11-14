import {
    ammoSettings,
    itemDisplayName,
    itemWeightGrams,
    pistolSettings,
} from '@zombi-survive/content';
import {
    type AmmoStack,
    copyItem,
    type ItemLocation,
    type PistolItem,
} from '@zombi-survive/domain';
import {
    firearmVersion,
    isFirearmSnapshot,
    isPickupSnapshot,
    isReloadCommand,
    protocolVersion,
} from '@zombi-survive/protocol';
import {
    inventoryWeightGrams,
    playerHands,
    playerInventory,
    reloadPistol,
} from '@zombi-survive/simulation';
import { expect, test, vi } from 'vitest';

import { LocalWorldFirearm } from '../../apps/server/src/local-world-firearm.ts';
import { LocalWorldMelee } from '../../apps/server/src/local-world-melee.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';
import { LocalWorldReload } from '../../apps/server/src/local-world-reload.ts';

const pistol: PistolItem = { itemId: 'gun', kind: 'pistol', magazineCapacity: 8, rounds: 3 };
const ammo: AmmoStack = { itemId: 'ammo', kind: 'ammo9mm', quantity: 8 };
const locations = (rounds = 3, quantity = 8): readonly ItemLocation[] => [
    { type: 'hands', playerId: 'solo', item: { ...pistol, rounds } },
    {
        type: 'container',
        playerId: 'solo',
        item: { ...ammo, quantity },
        cell: { column: 0, row: 0 },
    },
];
const reload = (
    source: readonly ItemLocation[],
    fields: { playerId?: string; itemId?: string; revision?: number } = {},
) =>
    reloadPistol({
        locations: source,
        playerId: 'solo',
        itemId: pistol.itemId,
        revision: 0,
        ...fields,
    });
const request = {
    type: 'reload-pistol',
    protocolVersion,
    firearmVersion,
    itemId: pistol.itemId,
    weaponRevision: 0,
};

test('reload moves only missing rounds and preserves the partial pack identity/cell with a new gun revision', () => {
    const source = locations();
    const result = reload(source);
    expect(playerHands(result, 'solo')).toEqual({ ...pistol, rounds: 8, revision: 1 });
    expect(playerInventory(result, 'solo')).toEqual([
        { ...ammo, quantity: 3, cell: { column: 0, row: 0 } },
    ]);
    expect(playerHands(source, 'solo')).toEqual(pistol);
    expect(playerInventory(source, 'solo')[0]).toMatchObject({ quantity: 8 });
    expect(reload(result)).toBe(result);
});
test('a short pack fills only what exists and becomes a non-playable consumed marker', () => {
    const result = reload(locations(0, 3));
    expect(playerHands(result, 'solo')).toMatchObject({ rounds: 3, revision: 1 });
    expect(playerInventory(result, 'solo')).toHaveLength(0);
    expect(result[1]).toEqual({ type: 'consumed', item: { ...ammo, quantity: 0 } });
});
test('full, missing, foreign, wrong kind and old revision cannot spend ammo', () => {
    const full = locations(8);
    expect(reload(full)).toBe(full);
    const empty = locations().filter(location => location.item.kind !== 'ammo9mm');
    expect(reload(empty)).toBe(empty);
    const wrong: readonly ItemLocation[] = [
        { type: 'hands', playerId: 'solo', item: pistol },
        {
            type: 'container',
            playerId: 'solo',
            item: { itemId: 'bandage', kind: 'bandage' },
            cell: { column: 0, row: 0 },
        },
    ];
    expect(reload(wrong)).toBe(wrong);
    const source = locations();
    expect(reload(source, { playerId: 'other' })).toBe(source);
    expect(reload(source, { itemId: 'other' })).toBe(source);
    expect(reload(source, { revision: 1 })).toBe(source);
    const foreign = source.map(location =>
        location.type === 'container' ? { ...location, playerId: 'other' } : location,
    );
    expect(reload(foreign)).toBe(foreign);
});
test('multiple packs conserve total rounds and use deterministic IDs, overflow and malformed stacks cannot create rounds', () => {
    const source = [
        ...locations(0, 3),
        {
            type: 'container' as const,
            playerId: 'solo',
            item: { ...ammo, itemId: 'b', quantity: 7 },
            cell: { column: 1, row: 0 },
        },
    ];
    const result = reload(source);
    expect(playerHands(result, 'solo')).toMatchObject({ rounds: 8 });
    expect(playerInventory(result, 'solo')).toEqual([
        { ...ammo, itemId: 'b', quantity: 2, cell: { column: 1, row: 0 } },
    ]);
    const overflow = locations().map(location =>
        location.type === 'hands'
            ? { ...location, item: { ...pistol, revision: Number.MAX_SAFE_INTEGER } }
            : location,
    );
    expect(reload(overflow, { revision: Number.MAX_SAFE_INTEGER })).toBe(overflow);
    expect(reload(locations(0, 0))).toEqual(locations(0, 0));
});
test('quantity survives item copies/placements and controls weight/display; ammo is never a hand weapon', () => {
    const ground = { ...ammo, quantity: 3, position: { xMeters: 2, yMeters: 3 } };
    expect(copyItem(ground)).toEqual({ ...ammo, quantity: 3 });
    expect(itemWeightGrams(ground)).toBe(36);
    expect(inventoryWeightGrams([ground, pistol])).toBe(836);
    expect(itemDisplayName(ground)).toBe('Патроны 9 мм ×3');
    expect(ammoSettings.stackQuantity).toBe(8);
    expect(pistolSettings.reloadTicks).toBe(40);
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    const pickup = new LocalWorldPickup(locations());
    expect(isPickupSnapshot(pickup.snapshot(movement.snapshot('first')))).toBe(true);
    expect(isPickupSnapshot({ ...pickup.snapshot(movement.snapshot('first')), hands: ammo })).toBe(
        false,
    );
    for (const quantity of [0, -1, 0.5, Infinity, 1025, undefined])
        expect(
            isPickupSnapshot({
                ...pickup.snapshot(movement.snapshot('first')),
                items: [{ ...ammo, quantity, cell: { column: 0, row: 0 } }],
            }),
        ).toBe(false);
});

const setup = ({ rounds = 3, quantity = 8 } = {}) => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    movement.join('tab');
    const pickup = new LocalWorldPickup(locations(rounds, quantity));
    const reload = new LocalWorldReload();
    const health = vi.fn(() => 100);
    const melee = new LocalWorldMelee(() => 'pistol');
    const firearm = new LocalWorldFirearm();
    const damage = vi.fn(() => ({ damage: 30, isKilled: false }));
    let sessions = ['first', 'tab'];
    const step = (beforeFinish: () => void = () => {}) => {
        movement.step();
        const snapshots = new Map(sessions.map(id => [id, movement.snapshot(id)]));
        pickup.step(snapshots, health);
        melee.step({ snapshots, zombies: [], obstacles: [], damage, health });
        const input = { snapshots, health, locations: () => pickup.stagedLocations() };
        reload.prepare(input);
        firearm.step({
            snapshots,
            zombies: [],
            obstacles: [],
            damage,
            health,
            isReloading: id => reload.isReloading(id),
            hands: id => pickup.hands(id),
            stageItem: item => {
                pickup.stageItem(item);
            },
            reserveAttack: input => melee.reserveAttack(input),
        });
        beforeFinish();
        reload.finish({
            ...input,
            stage: source => {
                pickup.stageLocations(source);
            },
        });
    };
    const confirm = () => {
        pickup.takePendingSave();
        pickup.confirmSave();
    };
    const state = () => reload.snapshot(movement.snapshot('first'));
    return {
        pickup,
        reload,
        firearm,
        health,
        step,
        confirm,
        state,
        setSessions: (next: string[]) => {
            sessions = next;
        },
    };
};
test('40 full ticks elapse before transferring; repeated requests/tabs do not reset progress or double spend', () => {
    const state = setup();
    state.reload.receive('first', request);
    state.reload.receive('tab', request);
    state.step();
    expect(state.state().reload?.remainingTicks).toBe(40);
    expect(state.pickup.takePendingSave()).toBeNull();
    for (let tick = 1; tick < 40; tick++) {
        state.reload.receive('tab', request);
        state.step();
        expect(state.state().reload?.remainingTicks).toBe(40 - tick);
        expect(state.pickup.hands('solo')).toEqual(pistol);
    }
    state.reload.receive('first', request);
    state.step();
    expect(state.state().reload).toBeNull();
    expect(state.pickup.hands('solo')).toEqual(pistol);
    state.confirm();
    expect(state.pickup.hands('solo')).toMatchObject({ rounds: 8, revision: 1 });
});
test('shots are blocked for the whole reload and a committed weapon change on completion cancels without spending', () => {
    const state = setup();
    state.reload.receive('first', request);
    state.step();
    for (let tick = 1; tick < 40; tick++) {
        state.firearm.receive('first', {
            type: 'shoot-pistol',
            protocolVersion,
            firearmVersion,
            itemId: pistol.itemId,
            weaponRevision: 0,
            aim: { x: 1, y: 0 },
        });
        state.step();
        expect(state.pickup.takePendingSave()).toBeNull();
    }
    state.pickup.receiveEquipment('tab', {
        type: 'unequip-weapon',
        protocolVersion,
        meleeVersion: 3,
        itemId: pistol.itemId,
    });
    state.step();
    expect(state.state().reload).toBeNull();
    state.confirm();
    expect(state.pickup.hands('solo')).toBeNull();
    const gun = state.pickup
        .stagedLocations()
        .find(location => location.item.itemId === pistol.itemId);
    expect(gun?.item).toEqual(pistol);
    const pack = state.pickup
        .stagedLocations()
        .find(location => location.item.itemId === ammo.itemId);
    expect(pack?.item).toEqual(ammo);
});
test('death at the exact completion tick cancels before transfer, including already prepared progress', () => {
    const state = setup();
    state.reload.receive('first', request);
    state.step();
    for (let tick = 1; tick < 40; tick++) state.step();
    state.step(() => {
        state.health.mockReturnValue(0);
    });
    expect(state.state().reload).toBeNull();
    expect(state.pickup.takePendingSave()).toBeNull();
    expect(state.pickup.hands('solo')).toEqual(pistol);
});
test('one tab leaving does not stop progress; the last disconnect or a new host cancels with unchanged items', () => {
    const state = setup();
    state.reload.receive('first', request);
    state.step();
    state.reload.leave('first');
    state.setSessions(['tab']);
    state.step();
    expect(state.state().reload?.remainingTicks).toBe(39);
    state.setSessions([]);
    state.step();
    expect(state.state().reload).toBeNull();
    expect(state.pickup.takePendingSave()).toBeNull();
    expect(new LocalWorldReload().isReloading('solo')).toBe(false);
    expect(state.pickup.hands('solo')).toEqual(pistol);
});
test('full/no ammo/dead and departed pending commands do not begin; malformed progress is rejected', () => {
    for (const state of [setup({ rounds: 8 }), setup({ quantity: 0 })]) {
        state.reload.receive('first', request);
        state.step();
        expect(state.state().reload).toBeNull();
    }
    const state = setup();
    state.health.mockReturnValue(0);
    state.reload.receive('first', request);
    state.step();
    expect(state.state().reload).toBeNull();
    state.health.mockReturnValue(100);
    state.reload.receive('first', request);
    state.reload.leave('first');
    state.step();
    expect(state.state().reload).toBeNull();
    expect(isReloadCommand(request)).toBe(true);
    expect(isReloadCommand({ ...request, weaponRevision: -1 })).toBe(false);
    expect(isFirearmSnapshot(state.state())).toBe(true);
    for (const remainingTicks of [-1, 41, 0.5, Infinity])
        expect(
            isFirearmSnapshot({
                ...state.state(),
                reload: { itemId: 'gun', totalTicks: 40, remainingTicks },
            }),
        ).toBe(false);
});
