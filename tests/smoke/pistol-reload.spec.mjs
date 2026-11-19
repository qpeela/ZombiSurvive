import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { firearmVersion, localWorldRoomId, protocolVersion } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { clickEquipmentAction, openEquipment } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3134';
const start = path => {
    const env = { ...process.env, PORT: '3134', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
    const exited = new Promise(resolve => host.once('exit', resolve));
    return { host, exited, output: () => output };
};
const stop = async (running, signal = 'SIGTERM') => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill(signal);
    await running.exited;
};
const seed = (path, rounds = 3, quantity = 8) => {
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    let itemId;
    store.saveItemLocations(
        store.initialItemLocations.map(location => {
            if (location.item.itemId === 'pistol-v1:0:0') {
                itemId = location.item.itemId;
                return {
                    type: 'hands',
                    playerId,
                    item: { itemId, kind: 'pistol', rounds, magazineCapacity: 8 },
                };
            }
            if (location.item.itemId === 'ammo9mm-v1:0:0')
                return {
                    type: 'container',
                    playerId,
                    item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity },
                    cell: { column: 0, row: 0 },
                };
            return location;
        }),
    );
    store.savePosition({ xMeters: 8, yMeters: 12 });
    store.close();
    return itemId;
};
const pack = page => page.locator('#inventory-items button[data-item-id="ammo9mm-v1:0:0"]');
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
        'melee-action',
        'shot-action',
        'firearm-state',
    ])
        room.onMessage(type, () => {});
    return room;
};
const request = (type, itemId, weaponRevision = 0) => ({
    type,
    protocolVersion,
    firearmVersion,
    itemId,
    weaponRevision,
    ...(type === 'shoot-pistol' ? { aim: { x: 1, y: 0 } } : {}),
});

test('R and HUD reload share progress across tabs, block shots, retain pack quantity and cancel on weapon replacement', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-reload-ui-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    const running = start(path);
    let tab;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(pack(page)).toContainText('×8');
        await expect(pack(page)).toContainText('96 г');
        tab = await context.newPage();
        await tab.goto(origin);
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await page.bringToFront();
        await page.keyboard.down('r');
        await expect(page.locator('#reload-progress')).toBeVisible();
        await expect(tab.locator('#reload-progress')).toBeVisible();
        await expect(page.locator('#pistol-shot')).toBeDisabled();
        await expect(page.locator('#pistol-reload')).toBeDisabled();
        await page.keyboard.down('r');
        await page.keyboard.up('r');
        await page.keyboard.press('Space');
        await page.locator('canvas').click({ button: 'right', position: { x: 600, y: 260 } });
        await page.screenshot({ path: '.cache/t038-reloading.png', fullPage: true });
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(pack(page)).toContainText('×3');
        await expect(pack(page)).toContainText('36 г');
        await expect(page.locator('#pistol-reload')).toBeDisabled();
        await page.locator('#pistol-shot').click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await openEquipment(page);
        await page.locator('#pistol-reload').click();
        await expect(page.locator('#reload-progress')).toBeVisible();
        await clickEquipmentAction(page, 'Экипировать топор');
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: топор');
        await expect(page.locator('#reload-progress')).toBeHidden();
        await clickEquipmentAction(page, 'Экипировать пистолет');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await expect(pack(page)).toContainText('×3');
        await page.locator('#pistol-reload').click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(pack(page)).toContainText('×2');
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(pack(page)).toContainText('×2');
        expect(errors).toEqual([]);
    } finally {
        await tab?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('SIGKILL during progress cancels without spending; a short pack then fills only available rounds and never respawns', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-reload-cancel-'));
    const path = join(directory, 'world.sqlite');
    seed(path, 0, 3);
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await page.locator('#pistol-reload').click();
        await expect(page.locator('#reload-progress')).toBeVisible();
        await stop(running, 'SIGKILL');
        const cancelled = new SoloWorldStore(path);
        expect(
            cancelled.initialItemLocations.find(
                location =>
                    location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
            ),
        ).toMatchObject({ item: { rounds: 0 } });
        expect(
            cancelled.initialItemLocations.find(
                location =>
                    location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
            ),
        ).toMatchObject({ type: 'container', item: { quantity: 3 } });
        cancelled.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await expect(page.locator('#reload-progress')).toBeHidden();
        await page.keyboard.press('r');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(pack(page)).toHaveCount(0);
        await expect(page.locator('#pistol-reload')).toBeDisabled();
        await page.screenshot({ path: '.cache/t038-partial-pack.png', fullPage: true });
        await stop(running, 'SIGKILL');
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(pack(page)).toHaveCount(0);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('first reload completion ack survives SIGKILL; stale retry cannot consume the remaining pack after a shot', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-reload-commit-'));
    const path = join(directory, 'world.sqlite');
    const itemId = seed(path);
    let running = start(path);
    let room;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        let state;
        const committingHost = running.host;
        room.onMessage('pickup-state', value => {
            state = value;
            if (value.hands?.rounds === 8 && value.hands.revision === 1)
                committingHost.kill('SIGKILL');
        });
        await expect.poll(() => state?.hands?.rounds).toBe(3);
        room.send('reload-pistol', request('reload-pistol', itemId));
        room.send('shoot-pistol', request('shoot-pistol', itemId));
        await running.exited;
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(
                location =>
                    location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
            ),
        ).toMatchObject({ item: { rounds: 8, revision: 1 } });
        expect(
            saved.initialItemLocations.find(
                location =>
                    location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
            ),
        ).toMatchObject({ item: { quantity: 3 } });
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        let reload;
        let tick = 0;
        state = null;
        room.onMessage('pickup-state', value => {
            state = value;
        });
        room.onMessage('firearm-state', value => {
            reload = value.reload;
        });
        room.onMessage('movement-snapshot', value => {
            tick = value.tick;
        });
        await expect.poll(() => state?.hands?.rounds).toBe(8);
        room.send('shoot-pistol', request('shoot-pistol', itemId, 1));
        await expect.poll(() => state?.hands?.rounds).toBe(7);
        room.send('reload-pistol', request('reload-pistol', itemId, 0));
        const sent = tick;
        await expect.poll(() => tick).toBeGreaterThan(sent + 4);
        expect(reload).toBeNull();
        expect(state.hands.rounds).toBe(7);
        room.send('reload-pistol', request('reload-pistol', itemId, 2));
        await expect.poll(() => state?.hands?.rounds).toBe(8);
        expect(state.items.find(item => item.kind === 'ammo9mm')?.quantity).toBe(2);
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('failed completion stops the real host without publishing a filled magazine or spending the pack', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-reload-failure-'));
    const path = join(directory, 'world.sqlite');
    const itemId = seed(path);
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_reload BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'fixture reload failure'); END",
    );
    database.close();
    const running = start(path);
    let room;
    const received = [];
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        room.onMessage('pickup-state', value => {
            received.push(value);
        });
        room.send('reload-pistol', request('reload-pistol', itemId));
        await running.exited;
        expect(running.output()).toContain(
            'Solo save failed; stopping host: fixture reload failure',
        );
        expect(received.length).toBeGreaterThan(0);
        expect(received.every(state => state.hands?.rounds === 3)).toBe(true);
        expect(
            received.every(
                state => state.items.find(item => item.kind === 'ammo9mm')?.quantity === 8,
            ),
        ).toBe(true);
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(
                location =>
                    location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
            ),
        ).toMatchObject({ item: { rounds: 3 } });
        expect(
            saved.initialItemLocations.find(
                location =>
                    location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
            ),
        ).toMatchObject({ item: { quantity: 8 } });
        saved.close();
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('world ammo pickup preserves a partial quantity through inventory and reload without respawning the pack', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-ammo-loot-ui-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    const ground = store.initialItemLocations.find(
        location => location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
    );
    if (ground?.type !== 'ground') throw new Error('Missing world ammo');
    store.savePosition(ground.item.position);
    store.saveItemLocations(
        store.initialItemLocations.map(location => {
            if (location.item.itemId === 'pistol-v1:0:0')
                return {
                    type: 'hands',
                    playerId,
                    item: {
                        itemId: location.item.itemId,
                        kind: 'pistol',
                        magazineCapacity: 8,
                        rounds: 0,
                    },
                };
            if (
                location.type === 'ground' &&
                location.item.itemId === 'ammo9mm-v1:0:0' &&
                location.item.kind === 'ammo9mm'
            )
                return { ...location, item: { ...location.item, quantity: 3 } };
            return location;
        }),
    );
    store.close();
    const running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await expect(page.locator('#pistol-reload')).toBeDisabled();
        await page.getByRole('button', { name: 'Подобрать патроны 9 мм ×3', exact: true }).click();
        await expect(pack(page)).toContainText('×3');
        await expect(pack(page)).toContainText('36 г');
        await page.screenshot({ path: '.cache/t038-ammo-loot.png', fullPage: true });
        await page.locator('#pistol-reload').click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(pack(page)).toHaveCount(0);
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(pack(page)).toHaveCount(0);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
