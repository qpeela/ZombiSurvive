import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3128';
test('living receiver sees a restored body in another chunk and can pick up its items once', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-body-ui-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    const diedAtMs = Date.now();
    const body = {
        corpseId: 'previous-life',
        playerId,
        diedAtMs,
        expiresAtMs: diedAtMs + 24 * 60 * 60 * 1000,
        position: { xMeters: -32, yMeters: -32 },
    };
    const itemId = `${playerId}:knife`;
    store.saveCombat(
        { health: 100, cooldownTicks: 0, bleedingTicks: 0 },
        store.initialItemLocations.map(location =>
            location.type === 'container' || location.type === 'hands'
                ? { type: 'corpse', corpseId: body.corpseId, item: location.item }
                : location,
        ),
        body.position,
        [body],
    );
    store.close();
    const env = { ...process.env, PORT: '3128', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
    try {
        await expect.poll(() => output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        const button = page
            .locator('#corpse-items button')
            .filter({ hasText: 'Забрать с тела: Нож' });
        await expect(button).toBeEnabled();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 0');
        await button.click();
        await expect(button).toHaveCount(0);
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await expect(page.locator('#corpse-items button')).toHaveCount(3);
        await page.reload();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await expect(page.locator('#corpse-items button')).toHaveCount(3);
        await expect(page.locator('canvas')).toHaveAttribute('data-corpses', /previous-life/);
        await page.screenshot({ path: '.cache/t033-corpse-container.png', fullPage: true });
        host.kill('SIGKILL');
        await exited;
        const restored = new SoloWorldStore(path);
        expect(restored.initialCorpses).toEqual([body]);
        expect(
            restored.initialItemLocations.filter(location => location.item.itemId === itemId),
        ).toEqual([expect.objectContaining({ type: 'container', playerId })]);
        restored.close();
    } finally {
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
        rmSync(directory, { recursive: true, force: true });
    }
});
