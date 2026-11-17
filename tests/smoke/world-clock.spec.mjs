import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3144';
const start = path => {
    const env = { ...process.env, PORT: '3144', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const time = async page => Number(await page.locator('#world-time').getAttribute('data-world-ms'));
const open = async page => {
    await page.goto(origin);
    await expect(page.locator('#world-time')).toHaveAttribute('data-world-ms', /^\d+$/);
};

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
