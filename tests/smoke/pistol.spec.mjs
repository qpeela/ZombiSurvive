import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { clickEquipmentAction } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3132';
test('a partial pistol magazine survives ground pickup, hands, inventory, tabs, reload and SIGKILL', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-pistol-ui-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const ground = store.initialItemLocations.find(location => location.item.kind === 'pistol');
    if (ground?.type !== 'ground') throw new Error('Missing pistol loot');
    store.savePosition(ground.item.position);
    store.saveItemLocations(
        store.initialItemLocations.map(location => {
            if (location.item.kind === 'pistol')
                return { ...location, item: { ...location.item, rounds: 3 } };
            if (location.type === 'container') return { type: 'expired', item: location.item };
            return location;
        }),
    );
    store.close();
    const launch = () => {
        const env = { ...process.env, PORT: '3132', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
    let tab;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await page.getByRole('button', { name: 'Взять: Пистолет 9 мм', exact: true }).click();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await expect(page.locator('#equipment-weight')).toContainText('836 г');
        await clickEquipmentAction(page, 'Экипировать пистолет');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(page.locator('#equipment-weight')).toContainText('836 г');
        await expect(page.locator('canvas')).toHaveAttribute('data-weapon', 'pistol');
        await expect(page.locator('canvas')).toHaveAttribute('data-weapon-visible', 'true');
        await expect(page.locator('#melee-attack')).toBeDisabled();
        tab = await context.newPage();
        await tab.goto(origin);
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await clickEquipmentAction(page, 'Убрать оружие в сетку');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: —');
        await expect(page.locator('#equipment-weight')).toContainText('836 г');
        await clickEquipmentAction(page, 'Экипировать пистолет');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(page.locator('#equipment-weight')).toContainText('836 г');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(page.locator('#equipment-weight')).toContainText('836 г');
        await page.screenshot({ path: '.cache/t036-pistol-magazine.png', fullPage: true });
        running.host.kill('SIGKILL');
        await running.exited;
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.filter(
                location => location.item.itemId === ground.item.itemId,
            ),
        ).toEqual([
            expect.objectContaining({
                type: 'hands',
                item: expect.objectContaining({ rounds: 3, magazineCapacity: 8 }),
            }),
        ]);
        saved.close();
        running = launch();
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(page.locator('#equipment-weight')).toContainText('836 г');
        await expect(page.locator('canvas')).toHaveAttribute('data-weapon', 'pistol');
        expect(errors).toEqual([]);
    } finally {
        await tab?.close();
        if (running.host.exitCode === null && running.host.signalCode === null)
            running.host.kill('SIGTERM');
        await running.exited;
        rmSync(directory, { recursive: true, force: true });
    }
});
