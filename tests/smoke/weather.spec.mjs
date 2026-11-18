import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3151';
const start = path => {
    const env = { ...process.env, PORT: '3151', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = fork('tests/fixtures/world-clock-host.mjs', {
        env,
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    const checkpoints = [];
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    host.on('message', message => {
        if (message.type === 'clock-checkpoint') checkpoints.push(message.worldTimeMs);
    });
    const exited = new Promise(resolve => host.once('exit', resolve));
    return { host, exited, output: () => output, checkpoints };
};
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill('SIGTERM');
    await running.exited;
};
const open = async (page, weather) => {
    await page.goto(origin);
    await expect(page.locator('#weather-label')).toHaveAttribute('data-weather', weather);
    await expect(page.locator('canvas')).toHaveAttribute('data-weather', weather);
};

const seedTime = (path, time) => {
    const seed = new SoloWorldStore(path);
    seed.savePosition({ xMeters: 0, yMeters: 0 }, time);
    seed.close();
};

test('clear weather becomes visible rain at the same host-clock boundary in two tabs', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-weather-boundary-'));
    const path = join(directory, 'world.sqlite');
    seedTime(path, 4 * 3_600_000 - 600_000);
    const running = start(path);
    const second = await context.newPage();
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'clear');
        await open(second, 'clear');
        await page.locator('canvas').screenshot({ path: '.cache/t058-clear.png' });
        await expect(page.locator('#weather-label')).toHaveText('Погода: Дождь', {
            timeout: 15000,
        });
        await expect(second.locator('#weather-label')).toHaveText('Погода: Дождь');
        await expect(page.locator('canvas')).toHaveAttribute('data-weather', 'rain');
        await expect(second.locator('canvas')).toHaveAttribute('data-weather', 'rain');
        await page.locator('canvas').screenshot({ path: '.cache/t058-rain.png' });
    } finally {
        await second.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('weather changes on an empty host and returning tabs, reload and restart agree with its durable clock', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-weather-empty-'));
    const path = join(directory, 'world.sqlite');
    const boundary = 8 * 3_600_000;
    seedTime(path, boundary - 600_000);
    let running = start(path);
    const second = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'rain');
        await open(second, 'rain');
        await page.goto('about:blank');
        await second.goto('about:blank');
        // IPC reports a committed production checkpoint; no client drives the world clock.
        await expect
            .poll(() => running.checkpoints.at(-1) ?? -1, { timeout: 15000 })
            .toBeGreaterThanOrEqual(boundary);
        await open(page, 'clear');
        await open(second, 'clear');
        await page.reload();
        await expect(page.locator('canvas')).toHaveAttribute('data-weather', 'clear');
        await stop(running);
        await expect(page.locator('#weather-label')).toHaveText('Погода: —');
        await expect(page.locator('canvas')).toHaveAttribute('data-weather', 'unknown');
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page, 'clear');
        await open(second, 'clear');
        expect(errors).toEqual([]);
    } finally {
        await second.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
