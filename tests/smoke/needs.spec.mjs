import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { hungerSettings, rationLoot, thirstSettings, workshopWater } from '@zombi-survive/content';

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
    store.savePosition(workshopWater.item.position, 0, { thirstMs: 5 * 3_600_000, hungerMs: 0 });
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

test('one ready ration reduces hunger independently of thirst and stays consumed after reconnect', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-ration-smoke-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    store.savePosition(rationLoot.item.position, 0, {
        thirstMs: 5 * 3_600_000,
        hungerMs: 8 * 3_600_000,
    });
    store.close();
    const host = startHost(path);
    try {
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        const hunger = page.locator('#hunger-status');
        const thirst = page.locator('#thirst-status');
        await expect(hunger).toBeVisible();
        await expect(thirst).toBeVisible();
        const pickUp = page.getByRole('button', { name: 'Взять: Готовый паёк', exact: true });
        await expect(pickUp).toBeEnabled();
        await pickUp.click();
        await openInventory(page);
        const ration = page.getByRole('button', { name: /^Переместить: Готовый паёк/ });
        await expect(ration).toBeVisible();
        const itemCount = page.locator('#inventory');
        await expect(itemCount).toHaveText('Контейнер: предметов 5');
        await ration.press('Shift+F10');
        await page.getByRole('menuitem', { name: 'Съесть', exact: true }).click();
        await expect(itemCount).toHaveText('Контейнер: предметов 4');
        await expect(ration).toHaveCount(0);
        await expect(hunger).toBeHidden();
        await expect(thirst).toBeVisible();
        await page.reload();
        await expect(thirst).toBeVisible();
        await openInventory(page);
        await expect(itemCount).toHaveText('Контейнер: предметов 4');
        await expect(pickUp).toHaveCount(0);
        await expect(hunger).toBeHidden();
    } finally {
        await host.stop('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
    }
});

for (const { supply, pickUpName, selector, action, affected, other } of [
    {
        supply: workshopWater,
        pickUpName: 'Бутылка воды',
        selector: /^Переместить: Бутылка воды/,
        action: 'Пить',
        affected: 'thirst',
        other: 'hunger',
    },
    {
        supply: rationLoot,
        pickUpName: 'Готовый паёк',
        selector: /^Переместить: Готовый паёк/,
        action: 'Съесть',
        affected: 'hunger',
        other: 'thirst',
    },
]) {
    test(`${action} removes only its own stamina penalty`, async ({ page }) => {
        const directory = mkdtempSync(join(tmpdir(), 'zombi-stamina-smoke-'));
        const path = join(directory, 'world.sqlite');
        const store = new SoloWorldStore(path);
        store.savePosition(supply.item.position, 0, {
            thirstMs: thirstSettings.maximumMs,
            hungerMs: hungerSettings.maximumMs,
        });
        store.close();
        const host = startHost(path);
        try {
            await expect.poll(host.output).toContain('Local world ready');
            await page.goto(origin);
            const hints = {
                thirst: 'Спринт быстрее тратит выносливость',
                hunger: 'Выносливость восстанавливается медленнее',
            };
            const affectedLabel = page.locator(`#${affected}-status`);
            const otherLabel = page.locator(`#${other}-status`);
            await expect(affectedLabel).toContainText(hints[affected]);
            await expect(otherLabel).toContainText(hints[other]);
            await page.getByRole('button', { name: `Взять: ${pickUpName}`, exact: true }).click();
            await openInventory(page);
            const item = page.getByRole('button', { name: selector });
            await expect(item).toBeVisible();
            await item.press('Shift+F10');
            await page.getByRole('menuitem', { name: action, exact: true }).click();
            await expect(affectedLabel).not.toContainText(hints[affected]);
            await expect(affectedLabel).toBeVisible();
            await expect(otherLabel).toContainText(hints[other]);
        } finally {
            await host.stop('SIGTERM');
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
