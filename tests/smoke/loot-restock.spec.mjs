import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { lootRestockSettings } from '@zombi-survive/content';
import { copyItem } from '@zombi-survive/domain';
import { localWorldRoomId } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3145';
const start = path => {
    const env = { ...process.env, PORT: '3145', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = spawn(process.execPath, [resolve('apps/server/dist/main.js')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const exited = new Promise(resolve =>
        host.once('exit', (code, signal) => resolve({ code, signal })),
    );
    return { host, exited, output: () => output };
};
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill('SIGTERM');
    return running.exited;
};
const seed = ({ path, quantity = 8, isPistolTaken = false }) => {
    const store = new SoloWorldStore(path);
    const ammo = store.lootPoints().find(point => point.kind === 'ammo9mm');
    if (ammo === undefined) throw new Error('Missing ammo point.');
    const pistol = store.lootPoints().find(point => {
        const isPistol = point.kind === 'pistol';
        const isSamePosition =
            point.position.xMeters === ammo.position.xMeters &&
            point.position.yMeters === ammo.position.yMeters;
        return isPistol && isSamePosition;
    });
    if (pistol === undefined) throw new Error('Missing coincident pistol.');
    store.savePosition(ammo.position);
    store.saveItemLocations(
        store.initialItemLocations.map(location => {
            if (location.item.itemId === ammo.itemId)
                return { ...location, item: { ...location.item, quantity } };
            const isTakenPistol = isPistolTaken && location.item.itemId === pistol.itemId;
            if (location.type === 'container' || isTakenPistol)
                return { type: 'expired', item: copyItem(location.item) };
            return location;
        }),
        isPistolTaken
            ? {
                  worldTimeMs: 0,
                  restocks: new Map([[pistol.itemId, lootRestockSettings.periodWorldMs]]),
              }
            : undefined,
    );
    store.close();
    return { ammo, pistol };
};

const open = async page => {
    await page.goto(origin);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
};
const ammoButton = page => page.getByRole('button', { name: /^Подобрать патроны 9 мм/ });

test('partial ground stock stays occupied; collecting its last pack saves one deadline across reload and restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-restock-live-'));
    const path = join(directory, 'world.sqlite');
    const { ammo, pistol } = seed({ path, quantity: 3 });
    let running = start(path);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await expect(page.locator('#restock-label')).toHaveText('Пополнение рядом: —');
        await page.getByRole('button', { name: 'Подобрать пистолет 9 мм', exact: true }).click();
        await expect(ammoButton(page)).toContainText('×3');
        await expect(page.locator('#restock-label')).toHaveAttribute(
            'data-point-id',
            pistol.itemId,
        );
        await stop(running);
        let saved = new SoloWorldStore(path);
        expect(saved.initialLootRestocks.has(ammo.itemId)).toBe(false);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammo.itemId),
        ).toMatchObject({ type: 'ground', item: { quantity: 3 } });
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await expect(ammoButton(page)).toContainText('×3');
        await expect(page.locator('#restock-label')).not.toHaveAttribute(
            'data-point-id',
            ammo.itemId,
        );
        await ammoButton(page).click();
        await expect(page.locator('#restock-label')).toHaveAttribute('data-point-id', ammo.itemId);
        const deadline = await page
            .locator('#restock-label')
            .getAttribute('data-ready-at-world-ms');
        await expect(page.locator('#restock-label')).toContainText(
            'Срок пополнения · Патроны 9 мм: День 1',
        );
        await expect(page.locator('#equipment-weight')).toContainText('932 г');
        await page.reload();
        await expect(page.locator('#restock-label')).toHaveAttribute(
            'data-ready-at-world-ms',
            deadline,
        );
        await stop(running);
        saved = new SoloWorldStore(path);
        expect(saved.initialLootRestocks.get(ammo.itemId)).toBe(Number(deadline));
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammo.itemId),
        ).toMatchObject({ type: 'container', item: { quantity: 3 } });
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await expect(page.locator('#restock-label')).toHaveAttribute(
            'data-ready-at-world-ms',
            deadline,
        );
        await expect(page.locator('#equipment-weight')).toContainText('932 г');
        await page.screenshot({ path: '.cache/t051-restock-timer.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a real rejected deadline commit publishes neither a timer nor collected ammo', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-restock-failure-'));
    const path = join(directory, 'world.sqlite');
    const { ammo } = seed({ path, isPistolTaken: true });
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_timer BEFORE UPDATE OF loot_restocks ON solo_world WHEN NEW.loot_restocks != OLD.loot_restocks BEGIN SELECT RAISE(ABORT, 'timer failure'); END",
    );
    database.close();
    const running = start(path);
    let room;
    const samples = [];
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        room = await new Client(origin, { headers: { Origin: origin } }).joinById(localWorldRoomId);
        room.reconnection.enabled = false;
        for (const type of [
            'movement-snapshot',
            'zombie-state',
            'health-state',
            'melee-state',
            'profile-state',
            'melee-action',
            'firearm-state',
            'shot-action',
        ])
            room.onMessage(type, () => {});
        room.onMessage('pickup-state', snapshot => samples.push(snapshot));
        await expect.poll(() => samples.length).toBeGreaterThan(0);
        await ammoButton(page).click();
        expect(await running.exited).toEqual({ code: 1, signal: null });
        expect(running.output()).toContain('timer failure');
        expect(
            samples.every(snapshot =>
                snapshot.restocks.every(point => point.pointId !== ammo.itemId),
            ),
        ).toBe(true);
        expect(
            samples.every(snapshot => snapshot.items.every(item => item.itemId !== ammo.itemId)),
        ).toBe(true);
        const saved = new SoloWorldStore(path);
        expect(saved.initialLootRestocks.has(ammo.itemId)).toBe(false);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammo.itemId),
        ).toMatchObject({ type: 'ground', item: { quantity: 8 } });
        saved.close();
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a due ammo point supplies one new pack while the previously carried pack survives reload and restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-ammo-replenish-'));
    const path = join(directory, 'world.sqlite');
    const { ammo } = seed({ path, isPistolTaken: true });
    const store = new SoloWorldStore(path);
    const deadline = 300_000;
    store.saveItemLocations(
        store.initialItemLocations.map(location =>
            location.item.itemId === ammo.itemId
                ? {
                      type: 'container',
                      playerId: store.initialWorld.playerId,
                      cell: { column: 0, row: 0 },
                      item: { itemId: ammo.itemId, kind: 'ammo9mm', quantity: 3 },
                  }
                : location,
        ),
        { worldTimeMs: 0, restocks: new Map([[ammo.itemId, deadline]]) },
    );
    store.close();
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await expect(ammoButton(page)).toBeHidden();
        await expect(ammoButton(page)).toContainText('×8', { timeout: 10_000 });
        await ammoButton(page).click();
        await expect(ammoButton(page)).toBeHidden();
        await expect(page.locator('#equipment-weight')).toContainText('132 г');
        await page.reload();
        await expect(page.locator('#equipment-weight')).toContainText('132 г');
        await stop(running);
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammo.itemId),
        ).toMatchObject({ type: 'container', item: { quantity: 3 } });
        expect(
            saved.initialItemLocations.filter(
                location => location.item.itemId === `${ammo.itemId}:restock:${deadline}`,
            ),
        ).toMatchObject([{ type: 'container', item: { quantity: 8 } }]);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await expect(page.locator('#equipment-weight')).toContainText('132 г');
        await expect(ammoButton(page)).toBeHidden();
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
