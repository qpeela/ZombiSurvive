import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { daylightPhases } from '@zombi-survive/content';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3147';
const start = path => {
    const env = { ...process.env, PORT: '3147', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
    await expect(page.locator('#daylight-label')).toHaveText(
        `Освещение: ${daylightPhases[phase].label}`,
    );
    await expect(page.locator('canvas')).toHaveAttribute('data-daylight-phase', phase);
    await expect(page.locator('canvas')).toHaveAttribute(
        'data-daylight-opacity',
        String(daylightPhases[phase].opacity),
    );
};

test('four world-clock phases visibly tint the same site, agree across tabs and survive host restart', async ({
    page,
    context,
}) => {
    test.setTimeout(60000);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-daylight-live-'));
    const path = join(directory, 'world.sqlite');
    let running;
    const second = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    second.on('pageerror', error => errors.push(error.message));
    try {
        // Seed increasing authoritative elapsed times; the browser never supplies or mocks its clock.
        for (const [hours, phase] of [
            [21, 'dawn'],
            [24, 'day'],
            [34, 'dusk'],
            [38, 'night'],
        ]) {
            const seed = new SoloWorldStore(path);
            seed.savePosition({ xMeters: 0, yMeters: 0 }, hours * 3_600_000);
            seed.close();
            running = start(path);
            await expect.poll(running.output).toContain('Local world ready');
            await open(page, phase);
            await open(second, phase);
            await page.locator('canvas').screenshot({ path: `.cache/t054-${phase}.png` });
            if (phase === 'night' || phase === 'day') {
                await page.screenshot({ path: `.cache/t062-${phase}.png` });
            }
            await stop(running);
            await expect(page.locator('#daylight-label')).toHaveText('Освещение: —');
            await expect(page.locator('canvas')).toHaveAttribute('data-daylight-phase', 'unknown');
            running = start(path);
            await expect.poll(running.output).toContain('Local world ready');
            await open(page, phase);
            await open(second, phase);
            await page.goto('about:blank');
            await second.goto('about:blank');
            await stop(running);
        }
        expect(errors).toEqual([]);
    } finally {
        if (running !== undefined) await stop(running);
        await second.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('the real host clock changes dawn to day in both open tabs without reload', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-daylight-boundary-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    seed.savePosition({ xMeters: 0, yMeters: 0 }, 23 * 3_600_000 - 600_000);
    seed.close();
    const running = start(path);
    const second = await context.newPage();
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'dawn');
        await open(second, 'dawn');
        await expect(page.locator('#daylight-label')).toHaveAttribute('data-phase', 'day', {
            timeout: 15000,
        });
        await expect(second.locator('#daylight-label')).toHaveAttribute('data-phase', 'day');
        await expect(page.locator('canvas')).toHaveAttribute('data-daylight-phase', 'day');
        await expect(second.locator('canvas')).toHaveAttribute('data-daylight-phase', 'day');
    } finally {
        await second.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
