import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { corpseSettings, lootRestockSettings } from '@zombi-survive/content';
import { copyItem, type Corpse, type ItemLocation } from '@zombi-survive/domain';
import { generateChunkLoot } from '@zombi-survive/worldgen';
import { afterEach, expect, test, vi } from 'vitest';

import { LocalWorldRoom } from '../../apps/server/src/local-world-room.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

for (const ownership of ['container', 'corpse'] as const) {
    test(`an unloaded point catches up once without clients, preserving old ammo in ${ownership} across restart`, () => {
        vi.useFakeTimers();
        const directory = mkdtempSync(join(tmpdir(), 'zombi-unloaded-restock-'));
        const path = join(directory, 'world.sqlite');
        const seed = new SoloWorldStore(path);
        const loot = generateChunkLoot({
            seed: 'zombi-survive',
            generatorVersion: 1,
            chunkX: 9,
            chunkY: -4,
        });
        const ammo = loot.find(item => item.kind === 'ammo9mm');
        if (ammo === undefined) throw new Error('Missing distant ammo.');
        const corpse: Corpse = {
            corpseId: 'old-life',
            playerId: seed.initialWorld.playerId,
            position: { xMeters: 100, yMeters: 100 },
            diedAtMs: Date.now(),
            expiresAtMs: Date.now() + corpseSettings.lifetimeMs,
        };
        const original: ItemLocation =
            ownership === 'corpse'
                ? {
                      type: 'corpse',
                      corpseId: corpse.corpseId,
                      item: { itemId: ammo.itemId, kind: 'ammo9mm', quantity: 3 },
                  }
                : {
                      type: 'container',
                      playerId: seed.initialWorld.playerId,
                      cell: { column: 0, row: 0 },
                      item: { itemId: ammo.itemId, kind: 'ammo9mm', quantity: 3 },
                  };
        const locations: ItemLocation[] = [
            ...seed.initialItemLocations.map(location =>
                location.type === 'container'
                    ? { type: 'expired' as const, item: copyItem(location.item) }
                    : location,
            ),
            ...loot.map(item =>
                item.itemId === ammo.itemId ? original : { type: 'ground' as const, item },
            ),
        ];
        const deadline = lootRestockSettings.periodWorldMs;
        seed.saveCombat(
            seed.initialCombat,
            locations,
            undefined,
            ownership === 'corpse' ? [corpse] : [],
            undefined,
            undefined,
            { worldTimeMs: deadline * 4, restocks: new Map([[ammo.itemId, deadline]]) },
        );
        seed.close();
        const store = new SoloWorldStore(path);
        const room = new LocalWorldRoom();
        let step = () => {};
        vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
            step = () => callback?.(50);
        });
        const failed = vi.fn();
        try {
            room.onCreate({
                access: new WorldAccess(false, 4000, 0, store.initialWorld.playerId),
                soloStore: store,
                onSaveError: failed,
            });
            expect(room.clients).toHaveLength(0);
            for (let tick = 0; tick < 100; tick++) {
                step();
                vi.advanceTimersByTime(1);
            }
            expect(failed).not.toHaveBeenCalled();
            room.onDispose();
            store.close();
            const restored = new SoloWorldStore(path);
            expect(
                restored.initialItemLocations.find(
                    location => location.item.itemId === ammo.itemId,
                ),
            ).toEqual(original);
            const replacements = restored.initialItemLocations.filter(location =>
                location.item.itemId.startsWith(`${ammo.itemId}:restock:`),
            );
            expect(replacements).toEqual([
                {
                    type: 'ground',
                    item: { ...ammo, itemId: `${ammo.itemId}:restock:${String(deadline)}` },
                },
            ]);
            expect(restored.initialLootRestocks.has(ammo.itemId)).toBe(false);
            if (ownership === 'corpse') expect(restored.initialCorpses).toContainEqual(corpse);
            restored.close();
        } finally {
            room.onDispose();
            store.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
