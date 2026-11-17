import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initialZombie } from '@zombi-survive/content';
import { expect, test } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldZombie } from '../../apps/server/src/local-world-zombie.ts';
import { readSavedZombiePositions } from '../../apps/server/src/saved-zombie.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';

test('a zombie lured across a chunk boundary returns once at its committed position', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-position-'));
    const path = join(directory, 'world.sqlite');
    try {
        const store = new SoloWorldStore(path);
        const zombies = new LocalWorldZombie();
        const movement = new LocalWorldMovement('world', 'solo');
        movement.join('tab');
        const base = movement.snapshot('tab');
        const zombieId = 'slow:0,0:-24,0';
        const snapshotsAt = (xMeters: number) =>
            new Map([
                [
                    'tab',
                    {
                        ...base,
                        player: { ...base.player, position: { xMeters, yMeters: 0 } },
                    },
                ],
            ]);
        for (let tick = 0; tick < 180; tick++) {
            zombies.step(snapshotsAt(-28 - tick * 0.075));
        }
        const position = zombies
            .shotTargets()
            .find(zombie => zombie.zombieId === zombieId)?.position;
        expect(position?.xMeters).toBeLessThan(-32);
        expect(zombies.pendingPositionSave()?.get(zombieId)).toEqual(position);
        zombies.step(new Map());
        store.saveCombat(
            store.initialCombat,
            undefined,
            undefined,
            undefined,
            undefined,
            zombies.pendingPositionSave() ?? undefined,
        );
        zombies.confirmPositionSave();
        expect(zombies.pendingPositionSave()).toBeNull();
        store.close();
        const restored = new SoloWorldStore(path);
        const resumed = new LocalWorldZombie(
            restored.initialZombieHealth,
            restored.initialZombiePositions,
        );
        // Visit both source and destination without waking the saved zombie.
        resumed.step(snapshotsAt(0));
        resumed.step(new Map());
        resumed.step(snapshotsAt(-64));
        expect(resumed.shotTargets().filter(zombie => zombie.zombieId === zombieId)).toEqual([
            { zombieId, position, targetPlayerId: null },
        ]);
        restored.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a moved dead zombie stays dead even when its destination loads first', () => {
    const zombie = new LocalWorldZombie(
        new Map([[initialZombie.zombieId, 0]]),
        new Map([[initialZombie.zombieId, { xMeters: -35, yMeters: 0 }]]),
    );
    const movement = new LocalWorldMovement('world', 'solo', { xMeters: -64, yMeters: 0 });
    movement.join('tab');
    zombie.step(new Map([['tab', movement.snapshot('tab')]]));
    expect(zombie.isAlive(initialZombie.zombieId)).toBe(false);
});

test('v14 migrates positions and corrupt position data fails closed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-position-migration-'));
    const path = join(directory, 'world.sqlite');
    try {
        new SoloWorldStore(path).close();
        let database = new DatabaseSync(path);
        database.exec(
            'ALTER TABLE solo_world DROP COLUMN zombie_positions; PRAGMA user_version = 14',
        );
        database.close();
        const store = new SoloWorldStore(path);
        expect(store.initialZombiePositions.size).toBe(0);
        store.close();
        database = new DatabaseSync(path);
        database
            .prepare('UPDATE solo_world SET zombie_positions = ? WHERE id = 1')
            .run(JSON.stringify([[initialZombie.zombieId, 1e100, 0]]));
        database.close();
        const bytes = readFileSync(path);
        expect(() => new SoloWorldStore(path)).toThrow('Invalid saved zombie positions');
        expect(readFileSync(path)).toEqual(bytes);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test.each([
    [['unknown', 0, 0]],
    [[initialZombie.zombieId, null, 0]],
    [[initialZombie.zombieId, 0, '0']],
    [
        [initialZombie.zombieId, 0, 0],
        [initialZombie.zombieId, 1, 1],
    ],
])('rejects malformed or duplicate saved positions: %j', (...records) => {
    expect(() => readSavedZombiePositions(JSON.stringify(records))).toThrow();
});
