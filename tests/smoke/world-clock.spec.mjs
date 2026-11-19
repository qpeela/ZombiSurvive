import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { weatherSettings } from '@zombi-survive/content';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3144';
const start = (path, holdAtMs) => {
    const env = { ...process.env, PORT: '3144', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    if (holdAtMs === undefined) delete env.WORLD_CLOCK_HOLD_AT_MS;
    else env.WORLD_CLOCK_HOLD_AT_MS = String(holdAtMs);
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
    const kill = setTimeout(() => running.host.kill('SIGKILL'), 4000);
    try {
        await running.exited;
    } finally {
        clearTimeout(kill);
    }
};
const time = async page => Number(await page.locator('#world-time').getAttribute('data-world-ms'));
const open = async page => {
    await page.goto(origin);
    await expect(page.locator('#world-time')).toHaveAttribute('data-world-ms', /^\d+$/);
};

test('world HUD waits for the host clock and supports both mouse and keyboard after reconnect', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-world-hud-'));
    const running = start(join(directory, 'world.sqlite'));
    const gate = Promise.withResolvers();
    const joinStarted = Promise.withResolvers();
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.route('**/matchmake/joinById/**', async route => {
            joinStarted.resolve();
            await gate.promise;
            await route.continue();
        });
        const widget = page.locator('#world-hud');
        const summary = widget.locator('summary');
        const clock = widget.locator('#world-time');
        const clarification = widget.getByText('Фаза суток влияет', { exact: false });
        const waiting = widget.getByText('Ожидание часов хоста');
        const canvas = page.locator('canvas');
        await page.goto(origin);
        await joinStarted.promise;
        await expect(waiting).toBeVisible();
        await expect(clock).toHaveText('Время мира: —');
        expect(await clock.getAttribute('data-world-ms')).toBeNull();
        await summary.hover();
        await page.mouse.down();
        gate.resolve();
        await expect(clock).toHaveAttribute('data-world-ms', /^\d+$/);
        await expect(waiting).toBeHidden();
        await page.mouse.up();
        await expect(clarification).toBeVisible();
        await page.locator('#game').focus();
        await page.keyboard.press('Tab');
        await expect(summary).toBeFocused();
        await page.keyboard.press('Space');
        await expect(clarification).toBeHidden();
        await page.keyboard.press('Enter');
        await expect(clarification).toBeInViewport({ ratio: 1 });
        const flashlight = page.locator('#flashlight');
        await expect(flashlight).toBeEnabled();
        await page.keyboard.press('l');
        await expect(flashlight).toHaveAttribute('aria-pressed', 'false');
        await canvas.evaluate(element => {
            element.addEventListener('pointerdown', () => {
                element.dataset.receivedHudClick = 'true';
            });
        });
        await clarification.click();
        await clarification.click({ button: 'right' });
        expect(await canvas.getAttribute('data-received-hud-click')).toBeNull();
        await page.screenshot({ path: '.cache/t065-world-hud.png' });

        await context.setOffline(true);
        await expect(waiting).toBeVisible();
        await expect(clock).toHaveText('Время мира: —');
        await expect(widget.locator('#daylight-label')).toHaveText('Освещение: —');
        await expect(widget.locator('#weather-label')).toHaveText('Погода: —');
        await expect(canvas).toHaveAttribute('data-weather', 'unknown');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(clock).toHaveAttribute('data-world-ms', /^\d+$/);
        await expect(waiting).toBeHidden();
        await expect(widget.locator('#daylight-label')).toHaveText('Освещение: День');
        await expect(widget.locator('#weather-label')).toHaveText('Погода: Ясно');
        await expect(canvas).toHaveAttribute('data-weather', 'clear');
        await expect(clarification).toBeVisible();
        await summary.click();
        await expect(clarification).toBeHidden();
        await summary.press('Space');
        await expect(clarification).toBeVisible();
    } finally {
        gate.resolve();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('an open world HUD and the scene follow the same live fog transition', async ({ page }) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-world-hud-fog-'));
    const path = join(directory, 'world.sqlite');
    const fogStart = weatherSettings.fogStartsAtWorldMs;
    const holdAtMs = fogStart - 60_000;
    const seed = new SoloWorldStore(path);
    seed.savePosition({ xMeters: 0, yMeters: 0 }, holdAtMs);
    seed.close();
    const running = start(path, holdAtMs);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        const weather = page.locator('#weather-label');
        const canvas = page.locator('canvas');
        await expect(weather).toHaveText('Погода: Ясно');
        await expect(canvas).toHaveAttribute('data-weather', 'clear');
        await page.locator('#world-hud summary').click();
        await expect(page.locator('.world-hud-help')).toBeVisible();
        running.host.send({ type: 'release-world-clock' });
        await expect(weather).toHaveText('Погода: Туман', { timeout: 15000 });
        await expect(canvas).toHaveAttribute('data-weather', 'fog');
        expect(await time(page)).toBeGreaterThanOrEqual(fogStart);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('world time advances with zero browsers, reloads and resumes from the final checkpoint', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-clock-live-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    seed.savePosition({ xMeters: 8, yMeters: 12 });
    seed.close();
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        const before = await time(page);
        await page.goto('about:blank');
        // Only the host remains; a commit notification proves a full game minute elapsed.
        await expect
            .poll(() => running.checkpoints.at(-1) ?? -1)
            .toBeGreaterThanOrEqual(before + 60_000);
        const withoutPlayers = running.checkpoints.at(-1);
        await open(page);
        expect(await time(page)).toBeGreaterThanOrEqual(withoutPlayers);
        await page.reload();
        await expect(page.locator('#world-time')).toContainText('День 1');
        await stop(running);
        const saved = new SoloWorldStore(path);
        const savedTime = saved.initialWorldTimeMs;
        expect(savedTime).toBeGreaterThanOrEqual(withoutPlayers);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        expect(await time(page)).toBeGreaterThanOrEqual(savedTime);
        await page.screenshot({ path: '.cache/t050-world-clock.png', fullPage: true });
    } finally {
        await page.goto('about:blank');
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
