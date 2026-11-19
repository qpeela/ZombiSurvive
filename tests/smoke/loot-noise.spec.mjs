import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { firearmVersion, localWorldRoomId, protocolVersion } from '@zombi-survive/protocol';
import { initialExpandedLoot } from '@zombi-survive/worldgen';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { clickEquipmentAction, openEquipment, openInventory } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3135';
const gunId = 'pistol-v1:0:0';
const start = path => {
    const env = { ...process.env, PORT: '3135', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const starter = page =>
    page
        .locator('canvas')
        .evaluate(canvas =>
            JSON.parse(canvas.dataset.zombies ?? '[]').find(
                zombie => zombie.zombieId === 'slow-zombie-1',
            ),
        );
const waitTicks = async (page, count) => {
    const status = page.getByRole('status');
    const tick = Number(await status.getAttribute('data-tick'));
    await expect
        .poll(async () => Number(await status.getAttribute('data-tick')))
        .toBeGreaterThanOrEqual(tick + count);
};

test('visible zombie at 8m stays calm; empty shot makes no noise, accepted gunshot starts investigation and actual pursuit', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-noise-ui-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    store.saveItemLocations(
        store.initialItemLocations.map(location => {
            if (location.item.itemId === gunId)
                return {
                    type: 'hands',
                    playerId,
                    item: { itemId: gunId, kind: 'pistol', rounds: 0, magazineCapacity: 8 },
                };
            if (location.item.itemId === 'ammo9mm-v1:0:0')
                return {
                    type: 'container',
                    playerId,
                    item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity: 1 },
                    cell: { column: 0, row: 0 },
                };
            return location;
        }),
    );
    store.close();
    const running = start(path);
    let observer;
    const samples = [];
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await expect
            .poll(() => starter(page))
            .toMatchObject({ position: { xMeters: -8, yMeters: 0 }, targetPlayerId: null });
        await waitTicks(page, 8);
        expect(await starter(page)).toMatchObject({
            position: { xMeters: -8 },
            targetPlayerId: null,
        });
        observer = await connect();
        observer.onMessage('zombie-state', state => {
            const zombie = state.zombies.find(zombie => zombie.zombieId === 'slow-zombie-1');
            if (zombie !== undefined) samples.push(zombie);
        });
        observer.send('shoot-pistol', {
            type: 'shoot-pistol',
            protocolVersion,
            firearmVersion,
            itemId: gunId,
            weaponRevision: 0,
            aim: { x: 1, y: 0 },
        });
        await waitTicks(page, 4);
        expect(await starter(page)).toMatchObject({
            position: { xMeters: -8 },
            targetPlayerId: null,
        });
        await page.keyboard.press('r');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 1/8');
        expect(await starter(page)).toMatchObject({
            position: { xMeters: -8 },
            targetPlayerId: null,
        });
        await page.locator('canvas').click({ button: 'right', position: { x: 600, y: 260 } });
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await expect
            .poll(() =>
                samples.some(
                    zombie => zombie.position.xMeters > -8 && zombie.targetPlayerId === null,
                ),
            )
            .toBe(true);
        await page.locator('canvas').screenshot({ path: '.cache/t039-gunshot-noise.png' });
        await expect.poll(async () => (await starter(page))?.targetPlayerId).toBe(playerId);
    } finally {
        observer?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('extra map pistol and ammo can be picked up; same-kind swaps preserve separate magazines, cancel reload and survive restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-extra-gun-ui-'));
    const path = join(directory, 'world.sqlite');
    const extraId = 'scatter-v1:pistol:west';
    const ammoId = `${extraId}:ammo`;
    const ground = initialExpandedLoot.find(item => item.itemId === extraId);
    if (ground === undefined) throw new Error('Missing west loot');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    store.savePosition(ground.position);
    store.saveItemLocations(
        store.initialItemLocations.map(location => {
            if (location.item.itemId === gunId)
                return {
                    type: 'hands',
                    playerId,
                    item: { itemId: gunId, kind: 'pistol', magazineCapacity: 8, rounds: 7 },
                };
            if (location.type === 'container') return { type: 'expired', item: location.item };
            return location;
        }),
    );
    store.close();
    let running = start(path);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const select = async id => {
        await openInventory(page);
        await page.locator(`#inventory-items button[data-item-id="${id}"]`).click();
    };
    const equip = async () => {
        await clickEquipmentAction(page, 'Экипировать пистолет');
    };
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await page.getByRole('button', { name: 'Подобрать пистолет 9 мм', exact: true }).click();
        await select(extraId);
        await equip();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await page.getByRole('button', { name: 'Подобрать патроны 9 мм ×8', exact: true }).click();
        await select(gunId);
        await equip();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await select(extraId);
        await openEquipment(page);
        await page.locator('#pistol-reload').click();
        await expect(page.locator('#reload-progress')).toBeVisible();
        await equip();
        await expect(page.locator('#reload-progress')).toBeHidden();
        await select(gunId);
        await equip();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await expect(
            page.locator(`#inventory-items button[data-item-id="${ammoId}"]`),
        ).toContainText('×8');
        await page.locator('#pistol-shot').click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 6/8');
        await select(extraId);
        await equip();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await page.screenshot({ path: '.cache/t039-extra-gun.png', fullPage: true });
        await stop(running, 'SIGKILL');
        const saved = new SoloWorldStore(path);
        expect(saved.initialItemLocations).toHaveLength(19);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === gunId),
        ).toMatchObject({ type: 'container', item: { rounds: 6, revision: 1 } });
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === extraId),
        ).toMatchObject({ type: 'hands', item: { rounds: 8 } });
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammoId),
        ).toMatchObject({ type: 'container', item: { quantity: 8 } });
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await select(gunId);
        await equip();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 6/8');
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
