import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { workshopWater } from '@zombi-survive/content';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { openInventory } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3159';
const startHost = path => {
    const env = { ...process.env, PORT: '3159', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopped = new Promise(resolve => host.once('exit', resolve));
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    return {
        output: () => output,
        stop: async signal => {
            if (host.exitCode === null && host.signalCode === null) host.kill(signal);
            await stopped;
        },
    };
};

test('drinking workshop water from inventory clears the thirst warning and survives a host restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-water-smoke-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    store.savePosition(workshopWater.item.position, 0, { thirstMs: 5 * 3_600_000 });
    store.close();
    let host = startHost(path);
    try {
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        const thirst = page.locator('#thirst-status');
        await expect(thirst).toHaveText(/^Жажда: 6[0-9]%$/);
        await expect(thirst).toBeVisible();
        const pickUp = page.getByRole('button', { name: 'Взять: Бутылка воды', exact: true });
        await expect(pickUp).toBeEnabled();
        await pickUp.click();
        await openInventory(page);
        const water = page.getByRole('button', { name: /^Переместить: Бутылка воды/ });
        await expect(water).toBeVisible();
        await water.press('Shift+F10');
        await page.getByRole('menuitem', { name: 'Пить', exact: true }).click();
        const empty = page.getByRole('button', { name: /^Переместить: Пустая бутылка/ });
        await expect(empty).toBeVisible();
        await expect(thirst).toBeHidden();

        // Acknowledging the drink implies a durable write, even before the periodic checkpoint.
        await host.stop('SIGKILL');
        host = startHost(path);
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        await openInventory(page);
        await expect(empty).toBeVisible();
        await expect(thirst).toBeHidden();
        await empty.press('Shift+F10');
        await expect(page.getByRole('menuitem', { name: 'Пить', exact: true })).toBeDisabled();
    } finally {
        await host.stop('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
    }
});
