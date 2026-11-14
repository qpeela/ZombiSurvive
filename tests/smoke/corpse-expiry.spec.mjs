import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3131';
test('host startup expires an offline body and retains collected loot through browser reload and restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-expiry-ui-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    const diedAtMs = Date.now() - 25 * 60 * 60 * 1000;
    const corpse = {
        corpseId: 'expired-life',
        playerId,
        diedAtMs,
        expiresAtMs: diedAtMs + 24 * 60 * 60 * 1000,
        position: { xMeters: -32, yMeters: -32 },
    };
    const knifeId = `${playerId}:knife`;
    store.saveCombat(
        { health: 100, cooldownTicks: 0, bleedingTicks: 0, lifeRevision: 1 },
        store.initialItemLocations.map(location => {
            if (location.item.itemId === knifeId) return location;
            if (location.type === 'container' || location.type === 'hands')
                return { type: 'corpse', corpseId: corpse.corpseId, item: location.item };
            return location;
        }),
        corpse.position,
        [corpse],
    );
    store.close();
    const launch = () => {
        const env = { ...process.env, PORT: '3131', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
        const exited = new Promise(resolve => host.once('exit', resolve));
        return { host, exited, output: () => output };
    };
    let running = launch();
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await expect(page.locator('#corpse-items button')).toHaveCount(0);
        await expect(page.locator('canvas')).toHaveAttribute('data-corpses', '[]');
        await page.reload();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await expect(page.locator('#corpse-items button')).toHaveCount(0);
        running.host.kill('SIGKILL');
        await running.exited;
        const saved = new SoloWorldStore(path);
        expect(saved.initialCorpses).toEqual([]);
        expect(
            saved.initialItemLocations.filter(location => location.type === 'expired'),
        ).toHaveLength(3);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === knifeId).type,
        ).toBe('container');
        saved.close();
        running = launch();
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await expect(page.locator('canvas')).toHaveAttribute('data-corpses', '[]');
    } finally {
        if (running.host.exitCode === null && running.host.signalCode === null)
            running.host.kill('SIGTERM');
        await running.exited;
        rmSync(directory, { recursive: true, force: true });
    }
});
