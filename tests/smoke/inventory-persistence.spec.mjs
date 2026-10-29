import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialGroundItem } from '@zombi-survive/content';
import { initialStateRequest, localWorldRoomId, pickupStateRequest } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3121';
const start = path => {
    const env = { ...process.env, PORT: '3121', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const seed = path => {
    const store = new SoloWorldStore(path);
    store.savePosition({ xMeters: 2, yMeters: 2 });
    store.close();
};
const open = async page => {
    await page.goto(origin);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
};
const occupied = page => page.locator('#inventory-grid [data-column="2"][data-row="2"]');

test('v2 migrates; inventory and hands survive tabs, reload and SIGKILL in a fresh browser', async ({
    page,
    context,
    browser,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-inventory-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    const old = new DatabaseSync(path);
    old.exec(
        'ALTER TABLE solo_world DROP COLUMN combat_state; ALTER TABLE solo_world DROP COLUMN item_location; PRAGMA user_version = 2',
    );
    old.close();
    let running = start(path);
    let fresh;
    let tab;
    let room;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        tab = await context.newPage();
        await open(tab);
        await expect(
            page.getByRole('button', { name: 'Подобрать бинт', exact: true }),
        ).toBeEnabled();
        await page.getByRole('button', { name: 'Подобрать бинт', exact: true }).click();
        for (const view of [page, tab]) {
            await expect(view.locator('#inventory')).toHaveText('Контейнер: предметов 5');
            await expect(view.locator('#ground-item')).toHaveText('На земле: пусто');
        }
        await tab
            .getByRole('button', { name: 'Переместить бинт · 2 × 1 · 100 г', exact: true })
            .click();
        await tab.getByRole('button', { name: 'Ячейка 3, 3', exact: true }).click();
        await expect(occupied(tab)).toHaveAttribute('data-occupied', 'true');
        await expect(occupied(page)).toHaveAttribute('data-occupied', 'true');
        await page.reload();
        await expect(occupied(page)).toHaveAttribute('data-occupied', 'true');
        await page.getByRole('button', { name: 'Экипировать топор', exact: true }).click();
        for (const view of [page, tab]) {
            await expect(view.locator('#weapon-label')).toHaveText('Оружие: топор');
            await expect(view.locator('#inventory')).toHaveText('Контейнер: предметов 4');
            await expect(
                view.getByRole('button', { name: 'Экипировать топор', exact: true }),
            ).toBeDisabled();
        }
        await page.reload();
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: топор');
        // UI confirmation is already a durable commit: no checkpoint delay is allowed here.
        await stop(running, 'SIGKILL');
        const saved = new DatabaseSync(path);
        expect(saved.prepare('PRAGMA user_version').get().user_version).toBe(6);
        expect(
            JSON.parse(
                saved.prepare('SELECT item_location FROM solo_world').get().item_location,
            ).find(location => location.item.kind === 'bandage'),
        ).toMatchObject({
            type: 'container',
            item: { itemId: initialGroundItem.itemId },
            cell: { column: 2, row: 2 },
        });
        const savedLocations = JSON.parse(
            saved.prepare('SELECT item_location FROM solo_world').get().item_location,
        );
        expect(savedLocations).toHaveLength(9);
        const savedPlayerId = saved.prepare('SELECT player_id FROM solo_world').get().player_id;
        expect(savedLocations.filter(location => location.type === 'hands')).toEqual([
            {
                type: 'hands',
                playerId: savedPlayerId,
                item: {
                    itemId: `${savedPlayerId}:axe`,
                    kind: 'axe',
                },
            },
        ]);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        fresh = await browser.newContext();
        const restored = await fresh.newPage();
        await open(restored);
        await expect(restored.locator('#weapon-label')).toHaveText('Оружие: топор');
        await expect(restored.locator('#inventory')).toHaveText('Контейнер: предметов 4');
        await expect(restored.locator('#inventory-grid [data-occupied="true"]')).toHaveCount(5);
        await restored.getByRole('button', { name: 'Убрать оружие в сетку', exact: true }).click();
        await expect(restored.locator('#weapon-label')).toHaveText('Оружие: в руках пусто');
        await expect(restored.locator('#inventory')).toHaveText('Контейнер: предметов 5');
        await expect(restored.locator('#ground-item')).toHaveText('На земле: пусто');
        await expect(occupied(restored)).toHaveAttribute('data-occupied', 'true');
        await expect(restored.locator('#inventory-grid [data-occupied="true"]')).toHaveCount(6);
        const client = new Client(origin, { headers: { Origin: origin } });
        room = await client.joinById(localWorldRoomId);
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
        const inventoryBefore = await room.request(pickupStateRequest);
        const before = await room.request(initialStateRequest);
        // None of these commands owns an equipable instance in the authenticated inventory.
        for (const value of [
            { type: 'equip-weapon', itemId: 'forged' },
            { type: 'equip-weapon', itemId: initialGroundItem.itemId },
            { type: 'equip-weapon', weapon: 'axe' },
            { type: 'unequip-weapon', itemId: `${before.player.playerId}:axe` },
        ])
            room.send(value.type, { ...value, protocolVersion: 5, meleeVersion: 3 });
        room.send('pickup-item', {
            type: 'pickup-item',
            protocolVersion: 5,
            itemId: initialGroundItem.itemId,
        });
        room.send('inventory-move', {
            type: 'inventory-move',
            protocolVersion: 5,
            inventoryVersion: 2,
            itemId: initialGroundItem.itemId,
            cell: { column: 2, row: 2 },
        });
        await expect
            .poll(async () => (await room.request(initialStateRequest)).tick)
            .toBeGreaterThan(before.tick + 3);
        const state = await room.request(pickupStateRequest);
        expect(state.groundItem).toBeNull();
        expect(state.items).toHaveLength(5);
        expect(state.hands).toBeNull();
        expect(state.items).toEqual(inventoryBefore.items);
        expect(state.items.filter(item => item.kind === 'bandage')).toEqual([
            { itemId: initialGroundItem.itemId, kind: 'bandage', cell: { column: 2, row: 2 } },
        ]);
        await restored.screenshot({ path: '.cache/t027-restored-inventory.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally {
        room?.connection.close();
        await tab?.close();
        await fresh?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

for (const action of ['pickup', 'equip']) {
    test(`a failed ${action} commit stops the host without confirming or losing items`, async ({
        page,
    }) => {
        const directory = mkdtempSync(join(tmpdir(), 'zombi-item-failure-'));
        const path = join(directory, 'world.sqlite');
        seed(path);
        const database = new DatabaseSync(path);
        database.exec(
            "CREATE TRIGGER reject_item BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'fixture item failure'); END",
        );
        database.close();
        let running = start(path);
        let room;
        const received = [];
        try {
            await expect.poll(running.output).toContain('Local world ready');
            const client = new Client(origin, { headers: { Origin: origin } });
            room = await client.joinById(localWorldRoomId);
            room.reconnection.enabled = false;
            for (const type of [
                'movement-snapshot',
                'zombie-state',
                'health-state',
                'melee-state',
                'profile-state',
            ])
                room.onMessage(type, () => {});
            room.onMessage('pickup-state', state => received.push(state));
            received.push(await room.request(pickupStateRequest));
            const movement = await room.request(initialStateRequest);
            if (action === 'pickup') {
                room.send('pickup-item', {
                    type: 'pickup-item',
                    protocolVersion: 5,
                    itemId: initialGroundItem.itemId,
                });
            } else {
                room.send('equip-weapon', {
                    type: 'equip-weapon',
                    protocolVersion: 5,
                    meleeVersion: 3,
                    itemId: `${movement.player.playerId}:axe`,
                });
            }
            expect(await running.exited).toEqual({ code: 1, signal: null });
            expect(running.output()).toContain(
                'Solo save failed; stopping host: fixture item failure',
            );
            expect(
                received.every(
                    state =>
                        state.items.length === 4 &&
                        state.groundItem !== null &&
                        state.hands === null,
                ),
            ).toBe(true);
            const restored = new DatabaseSync(path);
            expect(
                JSON.parse(
                    restored.prepare('SELECT item_location FROM solo_world').get().item_location,
                ).find(location => location.item.kind === 'bandage'),
            ).toEqual({ type: 'ground', item: initialGroundItem });
            restored.exec('DROP TRIGGER reject_item');
            restored.close();
            running = start(path);
            await expect.poll(running.output).toContain('Local world ready');
            await open(page);
            await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 4');
            await expect(page.locator('#ground-item')).toContainText('Бинт');
        } finally {
            room?.connection.close();
            await stop(running);
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
