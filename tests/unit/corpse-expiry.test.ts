import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type Client } from '@colyseus/core';
import { corpseSettings } from '@zombi-survive/content';
import type { Corpse, ItemLocation } from '@zombi-survive/domain';
import { expireCorpses } from '@zombi-survive/simulation';
import { afterEach, expect, test, vi } from 'vitest';

import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';
import { LocalWorldRoom } from '../../apps/server/src/local-world-room.ts';
import { LocalWorldZombie } from '../../apps/server/src/local-world-zombie.ts';
import { readSavedCorpses } from '../../apps/server/src/saved-corpse.ts';
import { SoloWorldStore } from '../../apps/server/src/solo-world-store.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

const corpse: Corpse = {
    corpseId: 'body',
    playerId: 'player',
    diedAtMs: 1000,
    expiresAtMs: 1000 + corpseSettings.lifetimeMs,
    position: { xMeters: 0, yMeters: 0 },
};
const knife: ItemLocation = {
    type: 'corpse',
    corpseId: corpse.corpseId,
    item: { itemId: 'player:knife', kind: 'knife' },
};
const directories: string[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.useRealTimers();
});
const seed = () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-expiry-'));
    directories.push(directory);
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path, () => corpse.diedAtMs);
    const playerId = store.initialWorld.playerId;
    const body = { ...corpse, playerId, position: { xMeters: -32, yMeters: -32 } };
    const items = store.initialItemLocations.map(location =>
        location.type === 'container' || location.type === 'hands'
            ? { type: 'corpse' as const, corpseId: body.corpseId, item: location.item }
            : location,
    );
    store.saveCombat({ health: 0, cooldownTicks: 0, bleedingTicks: 0 }, items, body.position, [
        body,
    ]);
    store.close();
    return { path, playerId, body, items };
};

test.each([-1, 0, 1])(
    'cleanup at expiry offset %i is deterministic, idempotent and preserves collected items',
    offset => {
        const collected: ItemLocation = {
            type: 'container',
            playerId: 'new-life',
            item: { itemId: 'collected', kind: 'club' },
            cell: { column: 0, row: 0 },
        };
        const next = expireCorpses({
            corpses: [corpse],
            locations: [knife, collected],
            nowMs: corpse.expiresAtMs + offset,
        });
        if (offset < 0) {
            expect(next).toBeNull();
            return;
        }
        expect(next).toEqual({
            corpses: [],
            locations: [{ type: 'expired', item: knife.item }, collected],
        });
        if (next === null) throw new Error('Missing expiry');
        expect(expireCorpses({ ...next, nowMs: corpse.expiresAtMs + 1 })).toBeNull();
    },
);

test('at the deadline, opening and direct pickup are refused before durable cleanup', () => {
    let nowMs = corpse.expiresAtMs - 1;
    const pickup = new LocalWorldPickup([knife], [corpse], () => nowMs);
    const movement = new LocalWorldMovement('world', 'player');
    movement.join('tab');
    const snapshot = movement.snapshot('tab');
    expect(pickup.snapshot(snapshot).corpses).toHaveLength(1);
    nowMs++;
    expect(pickup.snapshot(snapshot).corpses).toEqual([]);
    pickup.receive('tab', { type: 'pickup-item', protocolVersion: 5, itemId: knife.item.itemId });
    pickup.step(new Map([['tab', snapshot]]));
    expect(pickup.takePendingSave()).toBeNull();
    expect(pickup.snapshot(snapshot).items).toEqual([]);
    const bodies = pickup.stageExpiry(nowMs);
    expect(bodies).toEqual([]);
    expect(pickup.takePendingSave()).toEqual([{ type: 'expired', item: knife.item }]);
    pickup.confirmSave();
    pickup.setCorpses(bodies ?? []);
    expect(pickup.stageExpiry(nowMs)).toBeNull();
});

test('pickup before the boundary wins once; later cleanup retains it and refuses duplicate commands', () => {
    let nowMs = corpse.expiresAtMs - 1;
    const pickup = new LocalWorldPickup([knife], [corpse], () => nowMs);
    const movement = new LocalWorldMovement('world', 'player');
    movement.join('tab');
    const snapshot = movement.snapshot('tab');
    const command = { type: 'pickup-item', protocolVersion: 5, itemId: knife.item.itemId };
    pickup.receive('tab', command);
    pickup.step(new Map([['tab', snapshot]]));
    expect(pickup.takePendingSave()).toMatchObject([{ type: 'container', playerId: 'player' }]);
    pickup.confirmSave();
    nowMs++;
    const bodies = pickup.stageExpiry(nowMs);
    expect(pickup.takePendingSave()).toMatchObject([{ type: 'container', playerId: 'player' }]);
    pickup.confirmSave();
    pickup.setCorpses(bodies ?? []);
    pickup.receive('tab', command);
    pickup.step(new Map([['tab', snapshot]]));
    expect(pickup.takePendingSave()).toBeNull();
    expect(pickup.snapshot(snapshot).items).toHaveLength(1);
});

test('offline expiry removes unloaded bodies and remaining contents, but keeps a previously collected weapon', () => {
    const { path, items, playerId } = seed();
    const knifeId = `${playerId}:knife`;
    let store = new SoloWorldStore(path, () => corpse.expiresAtMs - 1);
    store.saveItemLocations(
        items.map(location =>
            location.item.itemId === knifeId
                ? { type: 'container', playerId, item: location.item, cell: { column: 0, row: 0 } }
                : location,
        ),
    );
    store.close();
    for (let attempt = 0; attempt < 2; attempt++) {
        store = new SoloWorldStore(path, () => corpse.expiresAtMs);
        expect(store.initialCorpses).toEqual([]);
        expect(
            store.initialItemLocations.filter(location => location.type === 'expired'),
        ).toHaveLength(3);
        expect(
            store.initialItemLocations.find(location => location.item.itemId === knifeId),
        ).toMatchObject({ type: 'container', playerId });
        expect(store.initialItemLocations.some(location => location.type === 'corpse')).toBe(false);
        expect(store.initialItemLocations).toHaveLength(items.length);
        store.close();
    }
});

test('legacy body deadline derives from original death once, including downtime, never from load time', () => {
    const { path, body } = seed();
    const database = new DatabaseSync(path);
    const { expiresAtMs: omitted, ...legacy } = body;
    expect(omitted).toBe(corpse.expiresAtMs);
    database.prepare('UPDATE solo_world SET corpses = ?').run(JSON.stringify([legacy]));
    database.close();
    let store = new SoloWorldStore(path, () => corpse.expiresAtMs - 1);
    expect(store.initialCorpses[0]?.expiresAtMs).toBe(body.diedAtMs + corpseSettings.lifetimeMs);
    store.close();
    store = new SoloWorldStore(path, () => corpse.expiresAtMs);
    expect(store.initialCorpses).toEqual([]);
    expect(store.initialItemLocations.filter(location => location.type === 'expired')).toHaveLength(
        4,
    );
    store.close();
});

test('failed startup cleanup rolls back body and all item locations together', () => {
    const { path, body, items } = seed();
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_expiry BEFORE UPDATE OF corpses ON solo_world BEGIN SELECT RAISE(ABORT, 'expiry disk failure'); END",
    );
    database.close();
    const before = readFileSync(path);
    expect(() => new SoloWorldStore(path, () => corpse.expiresAtMs)).toThrow(/expiry disk failure/);
    expect(readFileSync(path)).toEqual(before);
    const removeTrigger = new DatabaseSync(path);
    removeTrigger.exec('DROP TRIGGER reject_expiry');
    removeTrigger.close();
    const restored = new SoloWorldStore(path, () => corpse.expiresAtMs - 1);
    expect(restored.initialCorpses).toEqual([body]);
    expect(restored.initialItemLocations).toEqual(items);
    restored.close();
});

test('invalid deadlines and unknown tombstones fail closed instead of replenishing finite loot', () => {
    for (const expiresAtMs of [0, corpse.expiresAtMs + 1, null, Infinity, 'later'])
        expect(() =>
            readSavedCorpses(JSON.stringify([{ ...corpse, expiresAtMs }]), [knife]),
        ).toThrow(/corpses/);
    const { path } = seed();
    const database = new DatabaseSync(path);
    database
        .prepare('UPDATE solo_world SET item_location = ?')
        .run(JSON.stringify([{ type: 'expired', item: { itemId: 'unknown', kind: 'knife' } }]));
    database.close();
    const before = readFileSync(path);
    expect(() => new SoloWorldStore(path, () => corpse.expiresAtMs)).toThrow(/invalid item/);
    expect(readFileSync(path)).toEqual(before);
});

const createRoom = ({ isFailing = false, isDying = false } = {}) => {
    vi.useFakeTimers();
    const saved = seed();
    let nowMs = corpse.expiresAtMs - 1;
    const store = new SoloWorldStore(saved.path, () => nowMs);
    store.saveCombat({
        health: isDying ? 1 : 100,
        cooldownTicks: 0,
        bleedingTicks: isDying ? 1 : 0,
    });
    store.close();
    const live = new SoloWorldStore(saved.path, () => nowMs);
    const room = new LocalWorldRoom();
    let timestep = () => {};
    vi.spyOn(room, 'setTimestep').mockImplementation(callback => {
        timestep = () => callback?.(50);
    });
    vi.spyOn(LocalWorldZombie.prototype, 'step').mockReturnValue({ zombies: [], obstacles: [] });
    const handlers = new Map<string, (client: Client, value: unknown) => void>();
    vi.spyOn(room, 'onMessage').mockImplementation((type, callback: unknown) => {
        if (typeof type === 'string' && typeof callback === 'function')
            handlers.set(type, callback as (client: Client, value: unknown) => void);
        return () => {};
    });
    const failure = vi.fn();
    room.onCreate({
        access: new WorldAccess(false, 4000, 0, saved.playerId),
        soloStore: live,
        now: () => nowMs,
        onSaveError: failure,
    });
    const send = vi.fn<(type: string, value: unknown) => void>();
    for (const sessionId of ['first', 'tab']) {
        const client = { sessionId, auth: saved.playerId, send } as unknown as Client;
        room.clients.push(client);
        room.onJoin(client);
        handlers.get('pickup-item')?.(client, {
            type: 'pickup-item',
            protocolVersion: 5,
            itemId: `${saved.playerId}:knife`,
        });
    }
    const write = vi.spyOn(live, 'saveCombat');
    if (isFailing)
        write.mockImplementation(() => {
            throw new Error('expiry commit failed');
        });
    cleanups.push(() => {
        room.onDispose();
        live.close();
    });
    return {
        ...saved,
        live,
        failure,
        send,
        write,
        step: () => {
            nowMs = corpse.expiresAtMs;
            timestep();
            vi.advanceTimersByTime(1);
        },
    };
};

test.each([false, true])(
    'expiry and competing pickup use one durable step, including simultaneous death %j',
    isDying => {
        const { live, path, send, write, step } = createRoom({ isDying });
        step();
        expect(write).toHaveBeenCalledOnce();
        const snapshots = send.mock.calls.filter(([type]) => type === 'pickup-state');
        expect(snapshots).toHaveLength(2);
        for (const [, value] of snapshots) expect(value).toMatchObject({ items: [], hands: null });
        live.close();
        const restored = new SoloWorldStore(path, () => corpse.expiresAtMs);
        expect(
            restored.initialItemLocations.filter(location => location.type === 'expired'),
        ).toHaveLength(4);
        expect(restored.initialCorpses).toHaveLength(isDying ? 1 : 0);
        expect(restored.initialCorpses.some(body => body.corpseId === corpse.corpseId)).toBe(false);
        expect(restored.initialCombat.health).toBe(isDying ? 0 : 100);
        restored.close();
    },
);

test('runtime expiry disk failure stops before publication and retains the original container for recovery', () => {
    const { live, path, send, failure, step, items, body } = createRoom({ isFailing: true });
    step();
    step();
    expect(failure).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    live.close();
    const restored = new SoloWorldStore(path, () => corpse.expiresAtMs - 1);
    expect(restored.initialCorpses).toEqual([body]);
    expect(restored.initialItemLocations).toEqual(items);
    restored.close();
});
