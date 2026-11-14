import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { activateStartingZombie, clickWorld, movePlayerTo } from '../fixtures/game-controls.mjs';

const origin = 'http://127.0.0.1:3136';
const gunId = 'pistol-v1:0:0';
const ammoId = 'ammo9mm-v1:0:0';
const lifetimeMs = 24 * 60 * 60 * 1000 + 1;
const start = ({ path, offsetMs }) => {
    const env = {
        ...process.env,
        WORLD_SAVE_PATH: path,
        SOLO_ACCEPTANCE_CLOCK_OFFSET_MS: String(offsetMs),
    };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = spawn(process.execPath, ['tests/fixtures/solo-acceptance-host.mjs'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    const messages = [];
    host.on('message', message => messages.push(message));
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const exited = new Promise(resolve =>
        host.once('exit', (code, signal) => resolve({ code, signal })),
    );
    return { host, messages, exited, output: () => output };
};
const stop = async (running, signal = 'SIGTERM') => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill(signal);
    const exit = await running.exited;
    expect(exit).toEqual(signal === 'SIGKILL' ? { code: null, signal } : { code: 0, signal: null });
};
const ticks = async ({ page, count }) => {
    const status = page.getByRole('status');
    const tick = Number(await status.getAttribute('data-tick'));
    await expect
        .poll(async () => Number(await status.getAttribute('data-tick')))
        .toBeGreaterThanOrEqual(tick + count);
};
const health = async page => Number(await page.locator('#health').getAttribute('value'));
const inventoryAmmo = page => page.locator(`#inventory-items button[data-item-id="${ammoId}"]`);
const readSave = ({ path, offsetMs }) => {
    const store = new SoloWorldStore(path, () => Date.now() + offsetMs);
    try {
        return {
            world: store.initialWorld,
            combat: store.initialCombat,
            corpses: store.initialCorpses,
            items: store.initialItemLocations,
        };
    } finally {
        store.close();
    }
};
const assertRecovered = async page => {
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('#health')).toHaveAttribute('data-life-revision', '1');
    await expect(page.locator('#death-screen')).toBeHidden();
    await expect(page.locator('#player-name')).toHaveText('Имя: Одиночный цикл');
    await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
    await expect(inventoryAmmo(page)).toContainText('×4');
    await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
};

test('complete solo cycle uses real UI, retains one life and finite items across reconnect/restart, then expires only abandoned loot', async ({
    page,
    context,
}) => {
    // Real walking, two fights and natural death require a finite larger budget.
    test.setTimeout(120000);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-solo-acceptance-'));
    const path = join(directory, 'world.sqlite');
    let offsetMs = 0;
    let running = start({ path, offsetMs });
    let secondTab;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const restart = async () => {
        running = start({ path, offsetMs });
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    };
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#display-name')).toBeEnabled();
        await page.locator('#display-name').fill('Одиночный цикл');
        await page.locator('#save-name').click();
        await expect(page.locator('#player-name')).toHaveText('Имя: Одиночный цикл');
        await page.locator('#fullscreen').click();
        await expect
            .poll(() => page.evaluate(() => globalThis.document.fullscreenElement?.className))
            .toBe('game-shell');
        await expect(page.locator('#inventory-grid')).toBeInViewport();
        await page.getByRole('button', { name: 'Выйти из полного экрана' }).click();
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole('button', { name: 'Экипировать топор', exact: true }).click();
        const canvas = page.locator('canvas');
        await expect(canvas).toHaveAttribute('data-weapon', 'axe');
        await movePlayerTo({ page, position: { xMeters: 2, yMeters: 2 } });
        await page.getByRole('button', { name: 'Подобрать бинт', exact: true }).click();
        await activateStartingZombie(page);
        await expect.poll(() => health(page), { timeout: 10000 }).toBeLessThan(100);
        await expect(page.locator('#bleeding-label')).toContainText('есть');
        for (const damage of [60, 40]) {
            await page.locator('#melee-attack').click();
            await expect
                .poll(() =>
                    canvas.evaluate(
                        canvas => JSON.parse(canvas.dataset.meleeEffects ?? '[]').at(-1)?.impact,
                    ),
                )
                .toMatchObject({ zombieId: 'slow-zombie-1', damage });
            if (damage === 60) {
                await canvas.screenshot({ path: '.cache/t040-melee.png' });
                await ticks({ page, count: 25 });
            }
        }
        const woundedHealth = await health(page);
        await page.locator('#use-bandage').click();
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
        expect(await health(page)).toBeLessThanOrEqual(woundedHealth);
        await page.screenshot({ path: '.cache/t040-bandaged.png', fullPage: true });
        await movePlayerTo({ page, position: { xMeters: -10, yMeters: -6 } });
        await page.getByRole('button', { name: 'Подобрать пистолет 9 мм', exact: true }).click();
        await page.getByRole('button', { name: 'Экипировать пистолет', exact: true }).click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await page.getByRole('button', { name: 'Подобрать патроны 9 мм ×8', exact: true }).click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        const targetId = await canvas.evaluate(
            canvas =>
                JSON.parse(canvas.dataset.zombies ?? '[]').find(
                    zombie => zombie.position.xMeters === -24 && zombie.position.yMeters === 0,
                )?.zombieId,
        );
        expect(targetId).toBeDefined();
        for (let shot = 1; shot <= 4; shot++) {
            const target = await canvas.evaluate(
                (canvas, targetId) =>
                    JSON.parse(canvas.dataset.zombies ?? '[]').find(
                        zombie => zombie.zombieId === targetId,
                    ),
                targetId,
            );
            expect(target).toBeDefined();
            await clickWorld({ page, position: target.position, button: 'right' });
            await expect(page.locator('#ammo-label')).toHaveText(`Патроны: ${8 - shot}/8`);
            await expect
                .poll(() =>
                    canvas.evaluate(
                        canvas =>
                            JSON.parse(canvas.dataset.shotEffects ?? '[]').at(-1)?.action.impact,
                    ),
                )
                .toMatchObject({
                    outcome: shot === 4 ? 'kill' : 'hit',
                    damage: shot === 4 ? 10 : 30,
                });
            if (shot < 4) await ticks({ page, count: 11 });
        }
        await page.keyboard.press('r');
        await expect(page.locator('#reload-progress')).toBeVisible();
        await page.screenshot({ path: '.cache/t040-reload.png', fullPage: true });
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(inventoryAmmo(page)).toContainText('×4');
        await expect(page.locator('#death-screen')).toBeVisible({ timeout: 35000 });
        await page.screenshot({ path: '.cache/t040-death.png', fullPage: true });
        await stop(running);
        const dead = readSave({ path, offsetMs });
        expect(dead.combat.health).toBe(0);
        expect(dead.corpses).toHaveLength(1);
        expect(dead.items.filter(item => item.type === 'corpse')).toHaveLength(6);
        const corpsePosition = dead.corpses[0].position;
        await restart();
        await expect(page.locator('#death-screen')).toBeVisible();
        await page.reload();
        await expect(page.locator('#death-screen')).toBeVisible();
        await page.locator('#respawn').click();
        await expect(page.locator('#health')).toHaveAttribute('value', '100');
        await expect(page.locator('#health')).toHaveAttribute('data-life-revision', '1');
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 0');
        await movePlayerTo({ page, position: corpsePosition });
        await page.locator(`#corpse-items button[data-item-id="${gunId}"]`).click();
        await page.getByRole('button', { name: 'Экипировать пистолет', exact: true }).click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await page.locator(`#corpse-items button[data-item-id="${ammoId}"]`).click();
        await assertRecovered(page);
        await page.screenshot({ path: '.cache/t040-return.png', fullPage: true });
        await canvas.scrollIntoViewIfNeeded();
        await page.keyboard.down('Shift');
        await page.keyboard.down('s');
        try {
            await expect
                .poll(async () =>
                    Number(await page.getByRole('status').getAttribute('data-y-meters')),
                )
                .toBeGreaterThanOrEqual(8);
        } finally {
            await page.keyboard.up('s');
            await page.keyboard.up('Shift');
        }
        await stop(running);
        await restart();
        await assertRecovered(page);
        const beforeAdvance = Number(await page.getByRole('status').getAttribute('data-tick'));
        running.host.send({ advanceMs: lifetimeMs });
        offsetMs = lifetimeMs;
        await expect
            .poll(() => running.messages)
            .toContainEqual({ type: 'clock-advanced', offsetMs });
        await expect
            .poll(async () => Number(await page.getByRole('status').getAttribute('data-tick')))
            .toBeGreaterThan(beforeAdvance + 2);
        await stop(running);
        // Read raw SQLite first: opening SoloWorldStore would also perform startup
        // cleanup, which alone would not prove the live host committed expiry.
        const database = new DatabaseSync(path);
        try {
            expect(
                JSON.parse(database.prepare('SELECT corpses FROM solo_world').get().corpses),
            ).toEqual([]);
        } finally {
            database.close();
        }
        const expired = readSave({ path, offsetMs });
        expect(expired.items.filter(item => item.type === 'expired')).toHaveLength(4);
        expect(expired.items.find(item => item.item.itemId === gunId)).toMatchObject({
            type: 'hands',
            item: { rounds: 8 },
        });
        expect(expired.items.find(item => item.item.itemId === ammoId)).toMatchObject({
            type: 'container',
            item: { quantity: 4 },
        });
        expect(expired.combat.lifeRevision).toBe(1);
        expect(expired.combat.health).toBeGreaterThan(0);
        await restart();
        await assertRecovered(page);
        secondTab = await context.newPage();
        secondTab.on('pageerror', error => errors.push(error.message));
        await secondTab.goto(origin);
        await assertRecovered(secondTab);
        await page.reload();
        await assertRecovered(page);
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect(page.locator('#pistol-shot')).toBeDisabled();
        await context.setOffline(false);
        for (const current of [page, secondTab]) {
            await current.locator('#reconnect').click();
            await assertRecovered(current);
        }
        await stop(running, 'SIGKILL');
        await restart();
        await secondTab.reload();
        await assertRecovered(page);
        await assertRecovered(secondTab);
        await expect(canvas).toHaveAttribute('data-corpses', '[]');
        await page.screenshot({ path: '.cache/t040-restored.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally {
        await context.setOffline(false);
        await secondTab?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
