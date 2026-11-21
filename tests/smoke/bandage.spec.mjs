import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { localWorldRoomId, protocolVersion } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { clickEquipmentAction, clickGameAction } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3126';
const command = {
    type: 'use-bandage',
    protocolVersion: 5,
    inventoryVersion: 2,
    itemId: 'starter-bandage',
};
const seed = (
    path,
    {
        health = 70,
        bleedingTicks = 100,
        worldTimeMs,
        hasBandage = true,
        position = { xMeters: 8, yMeters: 12 },
    } = {},
) => {
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    store.savePosition(position, worldTimeMs);
    store.saveCombat(
        { health, bleedingTicks, cooldownTicks: 0 },
        store.initialItemLocations.map(location =>
            hasBandage && location.item.itemId === 'starter-bandage'
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
const openHealth = async page => {
    await page.getByRole('button', { name: 'Здоровье (H)', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Здоровье', exact: true });
    await expect(panel).toBeFocused();

    return panel;
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

test('night HUD shows bleeding and combat together, confirms bandaging and resets on disconnect', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-status-hud-'));
    const path = join(directory, 'world.sqlite');
    seed(path, { worldTimeMs: 14 * 3_600_000 });
    const running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        const canvas = page.locator('canvas');
        const hud = page.getByRole('group', { name: 'Состояние персонажа' });
        const bleeding = hud.locator('#bleeding-label');
        const combat = hud.locator('#combat-status');
        const idle = hud.locator('#combat-idle');
        const stamina = hud.locator('#stamina-label');
        const staminaMeter = hud.locator('#stamina');
        const load = page.locator('#inventory-panel #load-label');
        const status = page.getByRole('status');
        await expect(canvas).toHaveAttribute('data-daylight-phase', 'night');
        await expect(hud).toBeInViewport();
        for (const chip of ['.bleeding-chip', '.combat-chip', '.status-chip:has(#stamina)']) {
            await expect(hud.locator(`${chip} .status-icon`)).toHaveAttribute(
                'aria-hidden',
                'true',
            );
        }
        await expect(idle).toHaveText('Вне боя');
        const combatChip = hud.locator('.combat-chip');
        const bleedingChip = hud.locator('.bleeding-chip');
        await expect(load).toBeHidden();
        await clickEquipmentAction(page, 'Экипировать дубинку');
        await expect(page.locator('#melee-attack')).toBeEnabled();
        await page.keyboard.press('f');
        await expect(canvas).toHaveAttribute('data-weapon-attack-tick', /^\d+$/);
        await expect(combatChip).toHaveCSS('position', 'static');
        await expect(bleedingChip).toHaveCSS('position', 'static');
        await expect(combat).toBeInViewport({ ratio: 1 });
        await expect(bleeding).toHaveText('Кровотечение: есть');
        await expect(bleeding).toBeInViewport({ ratio: 1 });
        await expect(load).toHaveText(/^Нагрузка: \d+ г/);
        await expect(stamina).toHaveText('Выносливость: 100%');
        await expect(staminaMeter).toBeVisible();
        await page.screenshot({ path: '.cache/t064-night-status.png' });
        await page.locator('#game').focus();
        await page.keyboard.press('h');
        const panel = page.getByRole('region', { name: 'Здоровье', exact: true });
        await expect(panel).toBeFocused();
        await expect(panel.locator('#panel-health')).toHaveText(/^Здоровье: [1-7]\d \/ 100 HP$/);
        await expect(panel.locator('#panel-bleeding')).toHaveText('Кровотечение: есть');
        const treatment = panel.getByRole('button', { name: 'Перевязаться' });
        await expect(treatment).toBeEnabled();
        await expect(treatment).toHaveAccessibleDescription(
            'Бинт остановит кровотечение. Здоровье не восстановится.',
        );
        await panel.screenshot({ path: '.cache/t074-health-panel.png' });
        await treatment.click();
        await expect(panel.locator('#panel-bleeding')).toHaveText('Кровотечение: нет');
        await expect(treatment).toBeDisabled();
        const hp = await page.locator('#health').getAttribute('value');
        await expect(panel.locator('#panel-health')).toHaveText(`Здоровье: ${hp} / 100 HP`);
        await expect(bleeding).toHaveText('Кровотечение: нет');
        await expect(bleedingChip).toHaveCSS('position', 'absolute');
        await expect(combat).toBeVisible();

        await context.setOffline(true);
        await expect(status).toHaveAttribute('data-status', 'disconnected');
        await expect(bleeding).toHaveText('Кровотечение: —');
        await expect(panel.locator('#panel-health')).toHaveText('Здоровье: —');
        await expect(treatment).toHaveAccessibleDescription('Ожидание данных персонажа…');
        await expect(stamina).toHaveText('Выносливость: —');
        await expect(staminaMeter).toBeHidden();
        await expect(load).toHaveText('Нагрузка: —');
        await expect(idle).toHaveText('Бой: —');
        await expect(combat).toBeHidden();
        await expect(combatChip).toHaveCSS('position', 'absolute');
        await expect(bleedingChip).toHaveCSS('position', 'absolute');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(bleeding).toHaveText('Кровотечение: нет');
        await expect(stamina).toHaveText('Выносливость: 100%');
        await expect(staminaMeter).toBeVisible();
        await expect(load).toHaveText(/^Нагрузка: \d+ г/);
        await expect(combat).toBeHidden({ timeout: 15000 });
        await expect(idle).toHaveText('Вне боя');
        await expect(combatChip).toHaveCSS('position', 'absolute');
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

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
        await expect(page.locator('#use-bandage')).toBeEnabled();
        await expect(tab.locator('#use-bandage')).toBeEnabled();
        await expect(page.locator('#equipment-weight')).toContainText('2000 г');
        await page.screenshot({ path: '.cache/t031-before-bandage.png', fullPage: true });
        await clickGameAction(page, page.locator('#use-bandage'));
        for (const current of [page, tab]) {
            await expect(current.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
            await expect(current.locator('#inventory')).toHaveText('Контейнер: предметов 4');
            await expect(current.locator('#equipment-weight')).toContainText('1900 г');
            await expect(current.locator('#use-bandage')).toBeDisabled();
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
        await clickGameAction(page, page.locator('#use-bandage'));
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
            const panel = await openHealth(page);
            const action = panel.getByRole('button', { name: 'Перевязаться' });
            await expect(action).toBeDisabled();
            await expect(action).toHaveAccessibleDescription(
                state.health === 0 ? 'Персонаж погиб.' : 'Кровотечения нет.',
            );
            await expect(panel.locator('#panel-health')).toHaveText(
                `Здоровье: ${state.health} / 100 HP`,
            );
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

test('Health explains why an injured player without a bandage cannot treat bleeding', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-health-panel-'));
    const path = join(directory, 'world.sqlite');
    seed(path, { hasBandage: false });
    const running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        const panel = await openHealth(page);
        await expect(panel.locator('#panel-bleeding')).toHaveText('Кровотечение: есть');
        const action = panel.getByRole('button', { name: 'Перевязаться' });
        await expect(action).toBeDisabled();
        await expect(action).toHaveAccessibleDescription('В рюкзаке нет бинта.');
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('the outing journal records confirmed loot, damage and treatment once', async ({ page }) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-outing-journal-'));
    const path = join(directory, 'world.sqlite');
    seed(path, {
        bleedingTicks: 70,
        hasBandage: false,
        position: { xMeters: 2, yMeters: 2 },
    });
    const running = start(path);
    let peer;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await page.locator('#game').focus();
        await page.keyboard.press('j');
        const journal = page.getByRole('region', { name: 'Журнал вылазки' });
        const events = journal.getByRole('listitem');
        await expect(journal).toBeFocused();
        await expect(journal.getByText('В журнале пока нет событий.')).toBeVisible();
        peer = await observer();
        const tick = async () => Number(await page.getByRole('status').getAttribute('data-tick'));
        const before = await tick();
        peer.send('pickup-item', {
            type: 'pickup-item',
            protocolVersion,
            itemId: 'missing-loot-item',
        });
        await expect.poll(tick).toBeGreaterThanOrEqual(before + 3);
        await expect(events.filter({ hasText: 'Подобрано' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Взять: Бинт', exact: true }).click();
        await expect(events.filter({ hasText: 'Подобрано с земли: Бинт.' })).toHaveCount(1);
        await expect(events.filter({ hasText: 'Получен урон: 1 HP.' })).toHaveCount(1);
        const panel = await openHealth(page);
        await panel.getByRole('button', { name: 'Перевязаться' }).click();
        await expect(events.first()).toHaveText('Кровотечение остановлено.');
        await expect(events).toHaveCount(3);
        await journal.screenshot({ path: '.cache/t076-outing-journal.png' });
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(journal).toBeVisible();
    } finally {
        peer?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
