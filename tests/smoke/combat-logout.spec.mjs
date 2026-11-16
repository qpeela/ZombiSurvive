import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3140';
const start = path => {
    const env = { ...process.env, PORT: '3140', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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

test('offline zombie death shows one saved corpse and the death screen after restart', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-combat-logout-smoke-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    const playerId = seed.initialWorld.playerId;
    seed.savePosition({ xMeters: -7, yMeters: 0 });
    seed.saveCombat({ health: 20, cooldownTicks: 0, bleedingTicks: 0 });
    seed.close();
    let running = start(path);
    let returned;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(page.locator('#health-label')).toHaveText('Здоровье: 10 / 100', {
            timeout: 15000,
        });
        expect(await page.getByRole('status').getAttribute('data-player-id')).toBe(playerId);
        await page.close();

        // The host stays alive and the next zombie attack lands while no browser is connected.
        await new Promise(resolve => setTimeout(resolve, 1250));
        returned = await context.newPage();
        await returned.goto(origin);
        await expect(returned.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(returned.locator('#death-screen')).toBeVisible();
        await expect(returned.locator('#health-label')).toHaveText('Здоровье: 0 / 100');
        expect(await returned.getByRole('status').getAttribute('data-player-id')).toBe(playerId);

        await returned.close();
        returned = undefined;
        await stop(running);
        const saved = new SoloWorldStore(path);
        expect(saved.initialCombat.health).toBe(0);
        expect(saved.initialCorpses).toHaveLength(1);
        expect(saved.initialItemLocations.some(location => location.type === 'corpse')).toBe(true);
        saved.close();

        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        returned = await context.newPage();
        await returned.goto(origin);
        await expect(returned.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(returned.locator('#death-screen')).toBeVisible();
        await returned.close();
        returned = undefined;
        await stop(running);
        const afterRestart = new SoloWorldStore(path);
        expect(afterRestart.initialCorpses).toHaveLength(1);
        afterRestart.close();
    } finally {
        await returned?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
