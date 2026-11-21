import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
    coldSettings,
    fatigueSettings,
    hungerSettings,
    rationLoot,
    thirstSettings,
    wetnessSettings,
    workshopBench,
    workshopCanopy,
    workshopCrate,
    workshopWater,
} from '@zombi-survive/content';
import { copyItem, type ItemLocation } from '@zombi-survive/domain';
import {
    advanceCold,
    advanceNeeds,
    advanceWetness,
    drinkWater,
    eatRation,
    initialPlayerNeeds,
} from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

import { chunkLootForKey } from '../../apps/server/src/saved-chunk-loot.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

test('thirst depends on elapsed world time and caps at the maximum', () => {
    const firstHour = advanceNeeds(initialPlayerNeeds, 3_600_000);
    expect(firstHour.thirstMs).toBe(3_600_000);
    expect(advanceNeeds(firstHour, 3_600_000)).toEqual(advanceNeeds(initialPlayerNeeds, 7_200_000));
    expect(advanceNeeds(firstHour, thirstSettings.maximumMs).thirstMs).toBe(
        thirstSettings.maximumMs,
    );
});

test('drinking changes the owned bottle in place and cannot be replayed', () => {
    const playerId = 'player';
    const item = copyItem(workshopWater.item);
    const bottle = { type: 'container', playerId, item, cell: { column: 2, row: 1 } } as const;
    const input = {
        playerId,
        itemId: item.itemId,
        locations: [bottle],
        needs: { ...initialPlayerNeeds, thirstMs: thirstSettings.maximumMs },
    };

    expect(drinkWater({ ...input, playerId: 'another player' }).locations).toBe(input.locations);
    expect(drinkWater({ ...input, itemId: 'stale item' }).locations).toBe(input.locations);
    const after = drinkWater(input);
    expect(after.needs.thirstMs).toBe(thirstSettings.maximumMs - thirstSettings.servingReliefMs);
    expect(after.locations).toEqual([{ ...bottle, item: { ...item, servings: 0 } }]);
    const replay = drinkWater({ ...input, ...after });
    expect(replay.locations).toBe(after.locations);
    expect(replay.needs).toBe(after.needs);
});

test('v20 visited workshops receive one bottle and saved thirst and empty bottles survive restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-needs-'));
    const path = join(directory, 'world.sqlite');
    const knownStores: SoloWorldStore[] = [];
    const open = () => {
        const store = new SoloWorldStore(path);
        knownStores.push(store);
        return store;
    };
    try {
        const first = open();
        const key = '-1,0';
        const oldLoot = chunkLootForKey(key).filter(
            item => item.kind !== 'waterBottle' && item.itemId !== workshopCrate.stock.itemId,
        );
        const oldLocations = [
            ...first.initialItemLocations,
            ...oldLoot.map(item => ({ type: 'ground' as const, item })),
        ];
        first.close();
        const legacy = new DatabaseSync(path);
        try {
            legacy.exec(
                'ALTER TABLE solo_world DROP COLUMN needs_state; PRAGMA user_version = 20;',
            );
            legacy
                .prepare('UPDATE solo_world SET loot_chunks = ?, item_location = ?')
                .run(JSON.stringify([key]), JSON.stringify(oldLocations));
        } finally {
            legacy.close();
        }

        const migrated = open();
        expect(migrated.initialNeeds).toEqual(initialPlayerNeeds);
        expect(migrated.initialItemLocations).toEqual([
            ...oldLocations,
            { type: 'ground', item: workshopWater.item },
            { type: 'storage', storageId: workshopCrate.id, item: copyItem(workshopCrate.stock) },
        ]);
        const playerId = migrated.initialWorld.playerId;
        const locations = migrated.initialItemLocations.map((location): ItemLocation =>
            location.item.itemId === workshopWater.item.itemId
                ? {
                      type: 'container',
                      playerId,
                      item: copyItem(location.item),
                      cell: { column: 0, row: 2 },
                  }
                : location,
        );
        const after = drinkWater({
            playerId,
            locations,
            itemId: workshopWater.item.itemId,
            needs: { ...initialPlayerNeeds, thirstMs: thirstSettings.maximumMs },
        });
        migrated.saveItemLocations(after.locations, { needs: after.needs, worldTimeMs: 123_000 });
        migrated.close();

        const restored = open();
        expect(restored.initialNeeds).toEqual(after.needs);
        expect(restored.initialItemLocations).toEqual(after.locations);
        expect(restored.initialWorldTimeMs).toBe(123_000);
    } finally {
        for (const store of knownStores) store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('hunger follows the same game clock and a ration reduces only hunger once', () => {
    const needs = advanceNeeds(initialPlayerNeeds, hungerSettings.maximumMs);
    expect(needs.hungerMs).toBe(hungerSettings.maximumMs);
    const playerId = 'player';
    const item = copyItem(rationLoot.item);
    const ration = { type: 'container', playerId, item, cell: { column: 1, row: 2 } } as const;
    const input = { playerId, itemId: item.itemId, locations: [ration], needs };
    expect(eatRation({ ...input, playerId: 'someone else' }).locations).toBe(input.locations);

    const eaten = eatRation(input);
    expect(eaten.needs).toEqual({
        ...needs,
        hungerMs: needs.hungerMs - hungerSettings.rationReliefMs,
    });
    expect(eaten.locations).toEqual([{ type: 'consumed', item }]);
    expect(eatRation({ ...input, ...eaten })).toEqual(eaten);
});

test('v21 worlds preserve thirst, start with zero hunger and reset needs on respawn', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-hunger-'));
    const path = join(directory, 'world.sqlite');
    const stores: SoloWorldStore[] = [];
    const open = () => {
        const store = new SoloWorldStore(path);
        stores.push(store);
        return store;
    };
    try {
        const first = open();
        const key = '0,1';
        const oldLoot = chunkLootForKey(key).filter(item => item.kind !== 'ration');
        const oldLocations = [
            ...first.initialItemLocations,
            ...oldLoot.map(item => ({ type: 'ground' as const, item })),
        ];
        first.close();
        const legacy = new DatabaseSync(path);
        try {
            legacy.exec('PRAGMA user_version = 21');
            legacy
                .prepare(
                    'UPDATE solo_world SET loot_chunks = ?, item_location = ?, needs_state = ?',
                )
                .run(
                    JSON.stringify([key]),
                    JSON.stringify(oldLocations),
                    JSON.stringify({ thirstMs: 6000 }),
                );
        } finally {
            legacy.close();
        }

        const migrated = open();
        expect(migrated.initialNeeds).toEqual({
            thirstMs: 6000,
            hungerMs: 0,
            fatigueMs: 0,
            wetnessMs: 0,
            coldMs: 0,
        });
        expect(migrated.initialItemLocations).toEqual([
            ...oldLocations,
            { type: 'ground', item: rationLoot.item },
        ]);
        const afterDeath = migrated.initialItemLocations.map((location): ItemLocation =>
            location.type === 'container' || location.type === 'hands'
                ? { type: 'expired', item: location.item }
                : location,
        );
        migrated.saveCombat(
            { health: 0, cooldownTicks: 0, bleedingTicks: 0 },
            afterDeath,
            undefined,
            undefined,
            undefined,
            undefined,
            {
                worldTimeMs: 12_000,
                needs: {
                    thirstMs: 6000,
                    hungerMs: hungerSettings.noticeableMs,
                    fatigueMs: 0,
                    wetnessMs: 0,
                    coldMs: 0,
                },
            },
        );
        migrated.saveRespawn(0, { xMeters: 0, yMeters: 0 });
        migrated.close();
        const restored = open();
        expect(restored.initialNeeds).toEqual(initialPlayerNeeds);
        expect(restored.initialCombat).toMatchObject({ health: 100, lifeRevision: 1 });
        expect(restored.initialItemLocations).toEqual(afterDeath);
        expect(restored.initialWorldTimeMs).toBe(12_000);
    } finally {
        for (const store of stores) store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('awake fatigue accumulates by elapsed world time, saturates and keeps its stored value', () => {
    const elapsedWorldMs = 18 * 3_600_000;
    const half = elapsedWorldMs / 2;
    const needs = advanceNeeds(initialPlayerNeeds, elapsedWorldMs);
    expect(needs.fatigueMs).toBe(elapsedWorldMs);
    expect(advanceNeeds(advanceNeeds(initialPlayerNeeds, half), half)).toEqual(needs);
    expect(advanceNeeds(needs, elapsedWorldMs).fatigueMs).toBe(fatigueSettings.maximumMs);

    const directory = mkdtempSync(join(tmpdir(), 'zombi-fatigue-'));
    const path = join(directory, 'world.sqlite');
    try {
        const store = new SoloWorldStore(path);
        store.savePosition(store.initialWorld.position, elapsedWorldMs, needs);
        store.close();

        const restored = new SoloWorldStore(path);
        try {
            expect(restored.initialNeeds).toEqual(needs);
            expect(restored.initialWorldTimeMs).toBe(elapsedWorldMs);
        } finally {
            restored.close();
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('rain exposure stops at the canopy boundary and clear weather dries an exposed player', () => {
    const elapsedWorldMs = wetnessSettings.noticeableMs;
    const onBoundary = {
        xMeters: workshopCanopy.maxXMeters,
        yMeters: workshopBench.position.yMeters,
    };
    const outside = { ...onBoundary, xMeters: onBoundary.xMeters + 0.01 };
    const exposed = { position: outside, elapsedWorldMs };
    expect(advanceWetness({ ...exposed, wetnessMs: 0, weather: 'rain' })).toBe(elapsedWorldMs);
    expect(
        advanceWetness({ ...exposed, wetnessMs: wetnessSettings.maximumMs, weather: 'rain' }),
    ).toBe(wetnessSettings.maximumMs);
    expect(
        advanceWetness({
            position: onBoundary,
            elapsedWorldMs,
            wetnessMs: elapsedWorldMs,
            weather: 'rain',
        }),
    ).toBe(elapsedWorldMs);
    expect(advanceWetness({ ...exposed, wetnessMs: elapsedWorldMs, weather: 'clear' })).toBe(0);
    expect(advanceWetness({ ...exposed, wetnessMs: 0, weather: 'clear' })).toBe(0);
});

test('wetness doubles overnight cooling, and daytime warmth reverses it', () => {
    const elapsedWorldMs = coldSettings.walkPenaltyAtMs / 2;
    const exposure = { coldMs: 0, elapsedWorldMs };
    const dryCold = advanceCold({ ...exposure, phase: 'night', wetnessMs: 0 });
    const wetCold = advanceCold({ ...exposure, phase: 'night', wetnessMs: 1 });
    expect(dryCold).toBe(elapsedWorldMs);
    expect(wetCold).toBe(coldSettings.walkPenaltyAtMs);
    expect(advanceCold({ ...exposure, phase: 'dawn', coldMs: wetCold, wetnessMs: 1 })).toBe(
        wetCold,
    );
    expect(advanceCold({ ...exposure, phase: 'day', coldMs: wetCold, wetnessMs: 1 })).toBe(dryCold);
    expect(advanceCold({ ...exposure, phase: 'day', wetnessMs: 0 })).toBe(0);
});
