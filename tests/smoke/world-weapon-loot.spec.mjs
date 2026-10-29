import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialGroundItem } from '@zombi-survive/content';
import { initialStateRequest, localWorldRoomId, pickupStateRequest } from '@zombi-survive/protocol';
import { initialWorldWeaponLoot } from '@zombi-survive/worldgen';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3123';
const loot = initialWorldWeaponLoot.find(item => item.kind === 'knife');
const start = path => {
    const env = { ...process.env, PORT: '3123', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const stop = async (running, signal = 'SIGTERM') => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill(signal);
    return running.exited;
};
const open = async page => {
    await page.goto(origin);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
};
const connect = async () => {
    const room = await new Client(origin, { headers: { Origin: origin } }).joinById(
        localWorldRoomId,
    );
    room.reconnection.enabled = false;
    for (const type of [
        'movement-snapshot',
        'pickup-state',
        'zombie-state',
        'health-state',
        'melee-state',
        'profile-state',
    ])
        room.onMessage(type, () => {});
    return room;
};

test('world weapon refuses an overweight pickup, then survives pickup, exact-instance equip, tabs, reload and SIGKILL', async ({
    page,
    context,
    browser,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-world-loot-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    store.savePosition(loot.position);
    store.saveItemLocations(
        store.initialItemLocations.map(location =>
            location.item.itemId === initialGroundItem.itemId
                ? {
                      type: 'container',
                      playerId: store.initialWorld.playerId,
                      item: { itemId: initialGroundItem.itemId, kind: 'bandage' },
                      cell: { column: 0, row: 0 },
                  }
                : location,
        ),
    );
    store.close();
    let running = start(path);
    let room;
    let tab;
    let fresh;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        tab = await context.newPage();
        await open(tab);
        room = await connect();
        await expect(page.locator('#ground-item')).toContainText('Нож');
        await expect(
            page.getByRole('button', { name: 'Подобрать нож', exact: true }),
        ).toBeDisabled();
        await page.screenshot({ path: '.cache/t028-world-loot.png', fullPage: true });
        const before = await room.request(initialStateRequest);
        room.send('pickup-item', { type: 'pickup-item', protocolVersion: 5, itemId: loot.itemId });
        await expect
            .poll(async () => (await room.request(initialStateRequest)).tick)
            .toBeGreaterThan(before.tick + 3);
        expect((await room.request(pickupStateRequest)).groundItem).toEqual(loot);
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 5');
        await page.getByRole('button', { name: 'Экипировать топор', exact: true }).click();
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: топор');
        await page.getByRole('button', { name: 'Подобрать нож', exact: true }).click();
        for (const view of [page, tab]) {
            await expect(view.locator('#ground-item')).toHaveText('На земле: пусто');
            await expect(view.locator('#inventory')).toHaveText('Контейнер: предметов 5');
        }
        await page.locator(`[data-item-id="${loot.itemId}"]`).click();
        await page.getByRole('button', { name: 'Экипировать нож', exact: true }).click();
        await expect
            .poll(async () => (await room.request(pickupStateRequest)).hands?.itemId)
            .toBe(loot.itemId);
        await expect(tab.locator('#weapon-label')).toHaveText('Оружие: нож');
        await page.reload();
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: нож');
        await page.screenshot({ path: '.cache/t028-loot-equipped.png', fullPage: true });
        await stop(running, 'SIGKILL');
        const saved = new DatabaseSync(path);
        const locations = JSON.parse(
            saved.prepare('SELECT item_location FROM solo_world').get().item_location,
        );
        expect(locations).toHaveLength(9);
        expect(locations.filter(location => location.item.itemId === loot.itemId)).toMatchObject([
            { type: 'hands' },
        ]);
        saved.close();
        room.connection.close();
        room = undefined;
        await tab.close();
        tab = undefined;
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        fresh = await browser.newContext();
        const restored = await fresh.newPage();
        await open(restored);
        await expect(restored.locator('#weapon-label')).toHaveText('Оружие: нож');
        await expect(restored.locator('#ground-item')).toHaveText('На земле: пусто');
        room = await connect();
        const state = await room.request(pickupStateRequest);
        expect(state.hands.itemId).toBe(loot.itemId);
        expect(state.items.filter(item => item.kind === 'knife')).toHaveLength(1);
        room.send('pickup-item', { type: 'pickup-item', protocolVersion: 5, itemId: loot.itemId });
        const tick = (await room.request(initialStateRequest)).tick;
        await expect
            .poll(async () => (await room.request(initialStateRequest)).tick)
            .toBeGreaterThan(tick + 3);
        expect((await room.request(pickupStateRequest)).items).toEqual(state.items);
        expect(errors).toEqual([]);
    } finally {
        room?.connection.close();
        await tab?.close();
        await fresh?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('failed world loot commit stops the host with the weapon still on the ground and no false acknowledgement', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-world-loot-failure-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    store.savePosition(loot.position);
    store.close();
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_loot BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'loot disk failure'); END",
    );
    database.close();
    let running = start(path);
    let room;
    const received = [];
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        room.onMessage('pickup-state', state => received.push(state));
        received.push(await room.request(pickupStateRequest));
        room.send('pickup-item', { type: 'pickup-item', protocolVersion: 5, itemId: loot.itemId });
        expect(await running.exited).toEqual({ code: 1, signal: null });
        expect(running.output()).toContain('Solo save failed; stopping host: loot disk failure');
        expect(received.length).toBeGreaterThan(0);
        expect(
            received.every(
                state =>
                    state.groundItem?.itemId === loot.itemId &&
                    state.items.every(item => item.itemId !== loot.itemId),
            ),
        ).toBe(true);
        const saved = new DatabaseSync(path);
        const locations = JSON.parse(
            saved.prepare('SELECT item_location FROM solo_world').get().item_location,
        );
        expect(locations.find(location => location.item.itemId === loot.itemId)).toEqual({
            type: 'ground',
            item: loot,
        });
        saved.exec('DROP TRIGGER reject_loot');
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await expect(page.locator('#ground-item')).toContainText('Нож');
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
