import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { aimWorld } from '../fixtures/game-controls.mjs';

const origin = 'http://127.0.0.1:3149';
const start = path => {
    const env = { ...process.env, PORT: '3149', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const seed = (path, health = 100) => {
    const store = new SoloWorldStore(path);
    store.savePosition({ xMeters: 0, yMeters: -4 }, 14 * 3_600_000);
    store.saveCombat({ health, cooldownTicks: 0, bleedingTicks: health === 100 ? 0 : 100 });
    store.close();
};
const open = async page => {
    await page.goto(origin);
    await expect(page.locator('#flashlight')).toBeEnabled();
    await expect(page.locator('canvas')).toHaveAttribute('data-daylight-phase', 'night');
};
const zombieVisible = page =>
    page
        .locator('canvas')
        .evaluate(canvas =>
            JSON.parse(canvas.dataset.visibleZombies ?? '[]').includes('slow-zombie-1'),
        );

// Drive the same pointer and keyboard controls used by a player; no scene-state edits.
test('night flashlight reveals loot and a distant zombie only in the aimed beam; turning away and switching off hides them again', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-flashlight-live-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    const running = start(path);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        const canvas = page.locator('canvas');
        const button = page.locator('#flashlight');
        const pickup = page.getByRole('button', { name: 'Подобрать бинт', exact: true });
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'false');
        await expect.poll(() => zombieVisible(page)).toBe(false);
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await aimWorld({ page, position: { xMeters: 2, yMeters: 2 } });
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'true');
        await expect(pickup).toBeVisible();
        await expect.poll(() => zombieVisible(page)).toBe(false);
        await canvas.screenshot({ path: '.cache/t056-loot-beam.png' });
        await aimWorld({ page, position: { xMeters: 10, yMeters: -4 } });
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'false');
        await expect(pickup).toBeHidden();
        await aimWorld({ page, position: { xMeters: -8, yMeters: 0 } });
        await expect.poll(() => zombieVisible(page)).toBe(true);
        await canvas.screenshot({ path: '.cache/t056-zombie-beam.png' });
        await page.keyboard.press('l');
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => zombieVisible(page)).toBe(false);
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'false');
        await expect(page.getByRole('status')).toHaveAttribute('data-x-meters', '0');
        await expect(page.getByRole('status')).toHaveAttribute('data-y-meters', '-4');
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('L toggles once per press, ignores text entry, and HUD/reload/disconnect/retry reset the local flashlight safely', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-flashlight-input-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        const button = page.locator('#flashlight');
        await page.keyboard.down('l');
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.down('l');
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.up('l');
        await page.locator('#display-name').click();
        await page.keyboard.press('l');
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await page.reload();
        await expect(button).toBeEnabled();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await stop(running);
        await expect(button).toBeDisabled();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('canvas')).toHaveAttribute('data-flashlight-on', 'false');
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.getByRole('button', { name: 'Подключиться снова', exact: true }).click();
        await expect(button).toBeEnabled();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('authoritative death switches the lamp off and prevents keyboard toggling', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-flashlight-death-'));
    const path = join(directory, 'world.sqlite');
    seed(path, 2);
    const running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        const button = page.locator('#flashlight');
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#death-screen')).toBeVisible({ timeout: 15000 });
        await expect(button).toBeDisabled();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('canvas')).toHaveAttribute('data-flashlight-on', 'false');
        await page.keyboard.press('l');
        await expect(button).toHaveAttribute('aria-pressed', 'false');
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
