import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { movePlayerTo } from '../fixtures/game-controls.mjs';

const origin = 'http://127.0.0.1:3148';
const start = path => {
    const env = { ...process.env, PORT: '3148', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
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
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill('SIGTERM');
    await running.exited;
};
const open = async (page, phase) => {
    await page.goto(origin);
    await expect(page.locator('canvas')).toHaveAttribute('data-daylight-phase', phase);
};
const zombieVisible = page =>
    page
        .locator('canvas')
        .evaluate(canvas =>
            JSON.parse(canvas.dataset.visibleZombies ?? '[]').includes('slow-zombie-1'),
        );
const bandage = page => page.getByRole('button', { name: 'Взять: Бинт', exact: true });

test('the same distant zombie and bandage are visible by day, hidden at night with their hints, and the item reappears on approach', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-night-view-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    seed.savePosition({ xMeters: 0, yMeters: -4 }, 0);
    seed.close();
    let running = start(path);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'day');
        await expect.poll(() => zombieVisible(page)).toBe(true);
        await expect(page.locator('canvas')).toHaveAttribute('data-ground-item-visible', 'true');
        await expect(page.locator('#ground-item')).toContainText('Бинт');
        await expect(bandage(page)).toBeVisible();
        await page.locator('canvas').screenshot({ path: '.cache/t055-day.png' });
        await stop(running);
        const saved = new SoloWorldStore(path);
        saved.savePosition({ xMeters: 0, yMeters: -4 }, 14 * 3_600_000);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'night');
        await expect.poll(() => zombieVisible(page)).toBe(false);
        await expect(page.locator('canvas')).toHaveAttribute('data-ground-item-visible', 'false');
        await expect(page.locator('#ground-item')).toHaveText('На земле: пусто');
        await expect(bandage(page)).toBeHidden();
        await expect(page.locator('#pickup')).not.toHaveAttribute('title', /Бинт/);
        await expect(page.locator('canvas')).toHaveAttribute('data-zombies', /slow-zombie-1/);
        await page.locator('canvas').screenshot({ path: '.cache/t055-night.png' });
        await page.reload();
        await expect(page.locator('canvas')).toHaveAttribute('data-ground-item-visible', 'false');
        await expect(bandage(page)).toBeHidden();
        await movePlayerTo({ page, position: { xMeters: 2, yMeters: 1.5 } });
        await expect(page.locator('canvas')).toHaveAttribute('data-ground-item-visible', 'true');
        await expect(bandage(page)).toBeEnabled();
        await page.locator('canvas').screenshot({ path: '.cache/t055-near.png' });
        await movePlayerTo({ page, position: { xMeters: 0, yMeters: -4 } });
        await expect(page.locator('canvas')).toHaveAttribute('data-ground-item-visible', 'false');
        await expect(bandage(page)).toBeHidden();
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('the host dusk-to-night transition removes the distant loot hint in both open tabs', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-night-boundary-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    seed.savePosition({ xMeters: 0, yMeters: -4 }, 12 * 3_600_000 - 600_000);
    seed.close();
    const running = start(path);
    const second = await context.newPage();
    try {
        await expect.poll(running.output).toContain('Local world ready');
        for (const view of [page, second]) {
            await open(view, 'dusk');
            await expect(bandage(view)).toBeVisible();
        }
        for (const view of [page, second]) {
            await expect(view.locator('#daylight-label')).toHaveAttribute('data-phase', 'night', {
                timeout: 15000,
            });
            await expect(bandage(view)).toBeHidden();
            await expect(view.locator('canvas')).toHaveAttribute(
                'data-ground-item-visible',
                'false',
            );
        }
    } finally {
        await second.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
