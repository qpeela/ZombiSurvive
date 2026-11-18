import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { aimWorld, movePlayerTo } from '../fixtures/game-controls.mjs';

const origin = 'http://127.0.0.1:3150';
const start = path => {
    const env = { ...process.env, PORT: '3150', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
    store.savePosition({ xMeters: 0, yMeters: 0 }, 14 * 3_600_000);
    store.saveCombat(
        { health, cooldownTicks: 0, bleedingTicks: 0 },
        undefined,
        undefined,
        undefined,
        undefined,
        new Map([['slow-zombie-1', { xMeters: 8, yMeters: 0 }]]),
    );
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

test('the same zombie stays hidden behind the wall and appears through its open end', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-light-wall-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    const running = start(path);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await page.locator('#flashlight').click();
        await aimWorld({ page, position: { xMeters: 8, yMeters: 0 } });
        await expect.poll(() => zombieVisible(page)).toBe(false);
        await page.locator('canvas').screenshot({ path: '.cache/t057-wall.png' });
        await movePlayerTo({ page, position: { xMeters: 0, yMeters: -4 } });
        await aimWorld({ page, position: { xMeters: 8, yMeters: 0 } });
        await expect.poll(() => zombieVisible(page)).toBe(false);
        await movePlayerTo({ page, position: { xMeters: 6, yMeters: -4 } });
        await aimWorld({ page, position: { xMeters: 8, yMeters: 0 } });
        await expect.poll(() => zombieVisible(page)).toBe(true);
        await page.locator('canvas').screenshot({ path: '.cache/t057-passage.png' });
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
