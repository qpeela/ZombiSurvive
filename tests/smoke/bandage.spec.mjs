import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { localWorldRoomId } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3126';
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
    const env = { ...process.env, PORT: '3126', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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

test('inventory bandage confirms in both tabs, survives reload/retry and SIGKILL after ack without respawning', async ({
    page,
    context,
    browser,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-bandage-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
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
        await expect(
            page.getByRole('button', { name: 'Использовать бинт', exact: true }),
        ).toBeEnabled();
        await expect(
            tab.getByRole('button', { name: 'Использовать бинт', exact: true }),
        ).toBeEnabled();
        await page.screenshot({ path: '.cache/t031-before-bandage.png', fullPage: true });
        await page.getByRole('button', { name: 'Использовать бинт', exact: true }).click();
        for (const current of [page, tab]) {
            await expect(current.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
            await expect(current.locator('#inventory')).toHaveText('Контейнер: предметов 4');
            await expect(
                current.getByRole('button', { name: 'Использовать бинт', exact: true }),
            ).toBeDisabled();
        }
        const healedHealth = Number(await page.locator('#health').getAttribute('value'));
        expect(healedHealth).toBeGreaterThan(0);
        expect(healedHealth).toBeLessThanOrEqual(70);
        await page.screenshot({ path: '.cache/t031-after-bandage.png', fullPage: true });
        await page.reload();
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
        await context.setOffline(true);
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: —');
        await expect(page.locator('#use-bandage')).toBeDisabled();
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
        room = await observer();
        const killed = new Promise(resolve =>
            room.onMessage('health-state', state => {
                if (state.bleedingTicks === 0) {
                    running.host.kill('SIGKILL');
                    resolve(state);
                }
            }),
        );
        // A delayed duplicate names the consumed instance and cannot change anything.
        room.send('use-bandage', command);
        const confirmed = await killed;
        await running.exited;
        room.connection.close();
        room = undefined;
        const saved = new SoloWorldStore(path);
        expect(saved.initialCombat).toEqual({
            health: confirmed.health,
            bleedingTicks: 0,
            cooldownTicks: 0,
        });
        expect(saved.initialCombat.health).toBe(healedHealth);
        expect(saved.initialItemLocations.some(location => location.item.kind === 'bandage')).toBe(
            false,
        );
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        fresh = await browser.newContext();
        const restored = await fresh.newPage();
        await open(restored);
        await expect(restored.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
        await expect(restored.locator('#health-label')).toHaveText(
            `Здоровье: ${healedHealth} / 100`,
        );
        await expect(restored.locator('#inventory')).toHaveText('Контейнер: предметов 4');
        await expect(restored.locator('#use-bandage')).toBeDisabled();
        expect(errors).toEqual([]);
    } finally {
        room?.connection.close();
        await tab?.close();
        await fresh?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('real failed consumption commit stops host without a healed or consumed snapshot and retains both states', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-bandage-failure-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    const database = new DatabaseSync(path);
    database.exec(`CREATE TRIGGER reject_bandage BEFORE UPDATE OF item_location ON solo_world
        BEGIN SELECT RAISE(ABORT, 'bandage disk failure'); END`);
    database.close();
    const running = start(path);
    let room;
    const health = [];
    const pickups = [];
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        room = await observer();
        room.onMessage('health-state', state => health.push(state));
        room.onMessage('pickup-state', state => pickups.push(state));
        await expect.poll(() => health.length).toBeGreaterThan(0);
        await expect.poll(() => pickups.length).toBeGreaterThan(0);
        await page.getByRole('button', { name: 'Использовать бинт', exact: true }).click();
        expect(await running.exited).toEqual({ code: 1, signal: null });
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect(page.locator('#use-bandage')).toBeDisabled();
        expect(running.output()).toContain('Solo save failed; stopping host: bandage disk failure');
        expect(health.every(state => state.bleedingTicks > 0)).toBe(true);
        expect(pickups.every(state => state.items.some(item => item.kind === 'bandage'))).toBe(
            true,
        );
        const saved = new SoloWorldStore(path);
        expect(saved.initialCombat.bleedingTicks).toBeGreaterThan(0);
        expect(saved.initialItemLocations.some(location => location.item.kind === 'bandage')).toBe(
            true,
        );
        saved.close();
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

for (const state of [
    { health: 70, bleedingTicks: 0 },
    { health: 0, bleedingTicks: 100 },
]) {
    test(`bandage remains unused with ${state.health} HP and wound ${state.bleedingTicks}`, async ({
        page,
    }) => {
        const directory = mkdtempSync(join(tmpdir(), 'zombi-bandage-reject-'));
        const path = join(directory, 'world.sqlite');
        seed(path, state);
        const running = start(path);
        let room;
        try {
            await expect.poll(running.output).toContain('Local world ready');
            await open(page);
            await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 5');
            await expect(page.locator('#use-bandage')).toBeDisabled();
            room = await observer();
            let firstTick = -1;
            const observed = new Promise(resolve =>
                room.onMessage('health-state', snapshot => {
                    if (firstTick < 0) {
                        firstTick = snapshot.tick;
                        room.send('use-bandage', command);
                    }
                    if (snapshot.tick > firstTick) resolve(snapshot);
                }),
            );
            expect(await observed).toMatchObject(state);
            await stop(running);
            const saved = new SoloWorldStore(path);
            expect(saved.initialCombat).toMatchObject(state);
            expect(
                saved.initialItemLocations.some(location => location.item.kind === 'bandage'),
            ).toBe(true);
            saved.close();
        } finally {
            room?.connection.close();
            await stop(running);
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
