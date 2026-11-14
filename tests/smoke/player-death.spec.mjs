import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { localWorldRoomId } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3127';
const command = {
    type: 'use-bandage',
    protocolVersion: 5,
    inventoryVersion: 2,
    itemId: 'starter-bandage',
};
const seed = (path, { health = 70, bleedingTicks = 100 } = {}) => {
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    store.savePosition({ xMeters: 8, yMeters: 12 });
    store.saveCombat(
        { health, bleedingTicks, cooldownTicks: 0 },
        store.initialItemLocations.map(location =>
            location.item.kind === 'bandage'
                ? {
                      type: 'container',
                      playerId,
                      item: { itemId: 'starter-bandage', kind: 'bandage' },
                      cell: { column: 0, row: 0 },
                  }
                : location,
        ),
    );
    store.close();
};
const start = path => {
    const env = { ...process.env, PORT: '3127', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
    await running.exited;
};
const open = async page => {
    await page.goto(origin);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
};
const observer = async () => {
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
    ])
        room.onMessage(type, () => {});
    return room;
};

const assertDead = async page => {
    await expect(page.locator('#death-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#health-label')).toHaveText('Здоровье: 0 / 100');
    await expect(page.locator('.pickup-panel button:enabled')).toHaveCount(0);
    await expect
        .poll(async () => {
            const visible = await position(page);
            const status = page.getByRole('status');
            const xMeters = Number(await status.getAttribute('data-x-meters'));
            const yMeters = Number(await status.getAttribute('data-y-meters'));

            return Math.hypot(visible.xMeters - xMeters, visible.yMeters - yMeters);
        })
        .toBeLessThan(0.000001);
};
const position = page =>
    page.locator('canvas').evaluate(canvas => ({
        xMeters: (Number(canvas.dataset.playerX) - 480) / 24,
        yMeters: (Number(canvas.dataset.playerY) - 270) / 24,
    }));

test('bleeding death cancels held movement in both tabs and survives late commands, reload, retry and host restart', async ({
    page,
    context,
    browser,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-death-'));
    const path = join(directory, 'world.sqlite');
    seed(path, { health: 2, bleedingTicks: 100 });
    const initial = new SoloWorldStore(path);
    const items = initial.initialItemLocations;
    initial.close();
    let running = start(path);
    let tab;
    let room;
    let fresh;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        tab = await context.newPage();
        await open(tab);
        await expect(page.locator('#death-screen')).toBeHidden();
        await expect
            .poll(async () => Number(await page.locator('#health').getAttribute('value')))
            .toBeGreaterThan(0);
        await page.locator('canvas').scrollIntoViewIfNeeded();
        const startX = Number(await page.getByRole('status').getAttribute('data-x-meters'));
        await page.keyboard.down('d');
        await expect
            .poll(async () => Number(await page.getByRole('status').getAttribute('data-x-meters')))
            .toBeGreaterThan(startX + 0.1);
        await assertDead(page);
        await assertDead(tab);
        const deadPosition = await position(page);
        const tick = Number(await page.getByRole('status').getAttribute('data-tick'));
        await expect
            .poll(async () => Number(await page.getByRole('status').getAttribute('data-tick')))
            .toBeGreaterThan(tick + 3);
        expect(await position(page)).toEqual(deadPosition);
        await page.keyboard.up('d');
        await page.keyboard.press('f');
        room = await observer();
        const attacks = [];
        room.onMessage('melee-action', action => attacks.push(action));
        let deathTick;
        const rejected = new Promise(resolve =>
            room.onMessage('health-state', state => {
                if (deathTick === undefined) {
                    deathTick = state.tick;
                    room.send('movement-target', {
                        type: 'movement-target',
                        protocolVersion: 5,
                        sequence: 999,
                        target: { xMeters: 50, yMeters: 50 },
                        isSprinting: true,
                        isSneaking: true,
                    });
                    room.send('use-bandage', command);
                    room.send('inventory-move', {
                        ...command,
                        type: 'inventory-move',
                        cell: { column: 2, row: 2 },
                    });
                    const weapon = items.find(location => location.item.kind === 'knife');
                    room.send('equip-weapon', {
                        type: 'equip-weapon',
                        protocolVersion: 5,
                        meleeVersion: 3,
                        itemId: weapon.item.itemId,
                    });
                    room.send('melee-attack', {
                        type: 'melee-attack',
                        protocolVersion: 5,
                        meleeVersion: 3,
                    });
                }
                if (state.tick >= deathTick + 3) resolve(state);
            }),
        );
        expect(await rejected).toMatchObject({ health: 0, lifeState: 'dead' });
        expect(attacks).toEqual([]);
        expect(await position(page)).toEqual(deadPosition);
        await page.reload();
        await assertDead(page);
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await assertDead(page);
        await page.screenshot({ path: '.cache/t032-player-death.png', fullPage: true });
        running.host.kill('SIGKILL');
        await running.exited;
        room.connection.close();
        room = undefined;
        const saved = new SoloWorldStore(path);
        expect(saved.initialCombat.health).toBe(0);
        expect(saved.initialItemLocations).toEqual(items);
        expect(saved.initialWorld.position.xMeters).toBeCloseTo(deadPosition.xMeters, 10);
        expect(saved.initialWorld.position.yMeters).toBeCloseTo(deadPosition.yMeters, 10);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        fresh = await browser.newContext();
        const restored = await fresh.newPage();
        await open(restored);
        await assertDead(restored);
        expect(await position(restored)).toEqual(deadPosition);
        expect(errors).toEqual([]);
    } finally {
        room?.connection.close();
        await tab?.close();
        await fresh?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('SIGKILL on the first death acknowledgement retains zero HP and its exact final position', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-death-ack-'));
    const path = join(directory, 'world.sqlite');
    seed(path, { health: 1, bleedingTicks: 100 });
    const running = start(path);
    let room;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await observer();
        let lastPosition;
        room.onMessage('movement-snapshot', state => {
            lastPosition = state.player.position;
        });
        const death = new Promise(resolve =>
            room.onMessage('health-state', state => {
                if (state.lifeState === 'dead') {
                    running.host.kill('SIGKILL');
                    resolve(state);
                }
            }),
        );
        room.send('movement-target', {
            type: 'movement-target',
            protocolVersion: 5,
            sequence: 1,
            target: { xMeters: 8, yMeters: 15 },
            isSprinting: false,
            isSneaking: false,
        });
        expect(await death).toMatchObject({ health: 0, lifeState: 'dead' });
        await running.exited;
        const saved = new SoloWorldStore(path);
        expect(saved.initialCombat.health).toBe(0);
        expect(saved.initialWorld.position).toEqual(lastPosition);
        saved.close();
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
