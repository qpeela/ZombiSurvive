import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { aimWorld, movePlayerTo } from '../fixtures/game-controls.mjs';

const origin = 'http://127.0.0.1:3153';
const start = path => {
    const env = { ...process.env, PORT: '3153', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const seed = (path, worldTimeMs) => {
    const store = new SoloWorldStore(path);
    store.savePosition({ xMeters: 0, yMeters: -2 }, worldTimeMs);
    store.close();
};
const open = async (page, weather, phase) => {
    await page.goto(origin);
    await expect(page.locator('canvas')).toHaveAttribute('data-daylight-phase', phase);
    await expect(page.locator('#weather-label')).toHaveAttribute('data-weather', weather);
};
const zombieVisible = page =>
    page
        .locator('canvas')
        .evaluate(canvas =>
            JSON.parse(canvas.dataset.visibleZombies ?? '[]').includes('slow-zombie-1'),
        );

test('the same daytime landmark is visible at 08:00 in clear weather and hidden farther away at 08:00 in fog, then appears on approach', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-fog-day-'));
    const path = join(directory, 'world.sqlite');
    seed(path, 0);
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'clear', 'day');
        await expect.poll(() => zombieVisible(page)).toBe(true);
        await page.locator('canvas').screenshot({ path: '.cache/t059-clear-day.png' });
        await stop(running);
        seed(path, 24 * 3_600_000);
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'fog', 'day');
        await expect.poll(() => zombieVisible(page)).toBe(false);
        await page.locator('canvas').screenshot({ path: '.cache/t059-fog-day.png' });
        await movePlayerTo({ page, position: { xMeters: -1, yMeters: -2 } });
        await expect.poll(() => zombieVisible(page)).toBe(true);
        await movePlayerTo({ page, position: { xMeters: 0, yMeters: -2 } });
        await expect.poll(() => zombieVisible(page)).toBe(false);
        await page.reload();
        await expect(page.locator('canvas')).toHaveAttribute('data-weather', 'fog');
        await expect.poll(() => zombieVisible(page)).toBe(false);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('at the same night hour fog shortens the beam: a nearby bandage remains lit but the farther zombie stays hidden; disconnect removes mist', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-fog-night-'));
    const path = join(directory, 'world.sqlite');
    seed(path, 14 * 3_600_000);
    let running = start(path);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'clear', 'night');
        await page.locator('#flashlight').click();
        await aimWorld({ page, position: { xMeters: -8, yMeters: 0 } });
        await expect.poll(() => zombieVisible(page)).toBe(true);
        await stop(running);
        seed(path, 38 * 3_600_000);
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'fog', 'night');
        await page.locator('#flashlight').click();
        await aimWorld({ page, position: { xMeters: -8, yMeters: 0 } });
        await expect.poll(() => zombieVisible(page)).toBe(false);
        const canvas = page.locator('canvas');
        await aimWorld({ page, position: { xMeters: 2, yMeters: 2 } });
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'true');
        await page.locator('canvas').screenshot({ path: '.cache/t059-fog-night.png' });
        await page.locator('#flashlight').click();
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'false');
        await expect(page.getByRole('button', { name: 'Взять: Бинт', exact: true })).toBeHidden();
        await stop(running);
        await expect(canvas).toHaveAttribute('data-weather', 'unknown');
        await expect(canvas).toHaveAttribute('data-daylight-phase', 'unknown');
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
