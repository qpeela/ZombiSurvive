import type { InventoryItem } from '@zombi-survive/domain';
import { describe, expect, it, vi } from 'vitest';

import { trackOutingEvents } from '../../apps/client/src/outing-journal.ts';

type Journal = ReturnType<typeof trackOutingEvents>;
type Health = Parameters<Journal['acceptHealth']>[0];
type Inventory = Parameters<Journal['acceptInventory']>[0];

const player = { worldId: 'world', playerId: 'player' };
const position = { xMeters: 2, yMeters: 2 };
const bandage = { itemId: 'bandage', kind: 'bandage' } as const;
const club = { itemId: 'club', kind: 'club' } as const;
const knife = { itemId: 'knife', kind: 'knife' } as const;
const heldClub: InventoryItem = { ...club, cell: { column: 0, row: 0 } };
const packedBandage: InventoryItem = { ...bandage, cell: { column: 0, row: 1 } };

const health = (tick: number, change?: Partial<Health>): Health => ({
    ...player,
    tick,
    health: 70,
    lifeState: 'alive',
    lifeRevision: 0,
    bleedingTicks: 5,
    ...change,
});
const inventory = (tick: number, change?: Partial<Inventory>): Inventory => ({
    ...player,
    tick,
    items: [],
    hands: club,
    groundItem: { ...bandage, position },
    corpses: [
        {
            corpseId: 'body',
            playerId: 'other',
            diedAtMs: 0,
            expiresAtMs: 86_400_000,
            position,
            items: [knife],
        },
    ],
    ...change,
});

const acceptPair = (tracker: Journal, healthState: Health, inventoryState: Inventory): void => {
    tracker.acceptInventory(inventoryState);
    tracker.acceptHealth(healthState);
};

describe('outing journal', () => {
    it('uses the first complete tick as a baseline and ignores duplicate or unconfirmed changes', () => {
        const render = vi.fn();
        const tracker = trackOutingEvents(render);
        tracker.acceptHealth(health(1));
        tracker.acceptInventory(inventory(1));
        acceptPair(tracker, health(2), inventory(2));

        const afterDamageAndPickup = health(3, { health: 69, bleedingTicks: 0 });
        const afterInventory = inventory(3, { groundItem: null, items: [packedBandage] });
        tracker.acceptHealth(afterDamageAndPickup);
        expect(render).not.toHaveBeenCalled();
        tracker.acceptInventory(afterInventory);
        expect(render).toHaveBeenCalledExactlyOnceWith([
            'Получен урон: 1 HP.',
            'Кровотечение остановлено.',
            'Подобрано с земли: Бинт.',
        ]);
        acceptPair(tracker, afterDamageAndPickup, afterInventory);
        acceptPair(tracker, health(2), inventory(2));
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('distinguishes body loot from transfers between the grid and hands', () => {
        const render = vi.fn();
        const tracker = trackOutingEvents(render);
        acceptPair(tracker, health(1), inventory(1));
        acceptPair(
            tracker,
            health(2),
            inventory(2, { hands: knife, items: [heldClub], corpses: [] }),
        );

        expect(render).toHaveBeenCalledExactlyOnceWith(['Подобрано с тела: Нож.']);
    });

    it('keeps the last twelve events and clears them when the character respawns', () => {
        const render = vi.fn();
        const tracker = trackOutingEvents(render);
        acceptPair(tracker, health(1), inventory(1));
        for (let tick = 2; tick <= 14; tick++)
            acceptPair(tracker, health(tick, { health: 71 - tick }), inventory(tick));

        expect(render).toHaveBeenLastCalledWith(Array<string>(12).fill('Получен урон: 1 HP.'));
        acceptPair(
            tracker,
            health(15, { lifeState: 'dead', health: 0, bleedingTicks: 0 }),
            inventory(15, { hands: null }),
        );
        expect(render).toHaveBeenLastCalledWith([
            'Получен урон: 57 HP.',
            ...Array<string>(11).fill('Получен урон: 1 HP.'),
        ]);
        acceptPair(
            tracker,
            health(16, { lifeRevision: 1, health: 100, bleedingTicks: 0 }),
            inventory(16, { hands: null }),
        );
        expect(render).toHaveBeenLastCalledWith([]);
    });

    it('starts a fresh baseline after reconnect and clears history if a new life started offline', () => {
        const render = vi.fn();
        const tracker = trackOutingEvents(render);
        acceptPair(tracker, health(5), inventory(5));
        acceptPair(tracker, health(6, { health: 69 }), inventory(6));
        tracker.disconnect();
        acceptPair(tracker, health(1, { health: 62 }), inventory(1));
        expect(render).toHaveBeenCalledExactlyOnceWith(['Получен урон: 1 HP.']);

        tracker.disconnect();
        acceptPair(tracker, health(1, { lifeRevision: 1 }), inventory(1));
        expect(render).toHaveBeenLastCalledWith([]);
    });
});
