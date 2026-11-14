import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { localWorldRoomId } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3130';
const start = path => {
    const env = { ...process.env, PORT: '3130', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill('SIGTERM');
    await running.exited;
};

test('death, explicit respawn in both tabs, return and pickup survive old commands, reload and SIGKILL', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-respawn-ui-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    store.saveDisplayName('Вернувшийся');
    store.saveCombat({ health: 1, cooldownTicks: 0, bleedingTicks: 20 }, undefined, {
        xMeters: 2,
        yMeters: 0,
    });
    store.close();
    let running = start(path);
    let tab;
    let observer;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#death-screen')).toBeVisible();
        await page.reload();
        await expect(page.locator('#death-screen')).toBeVisible();
        tab = await context.newPage();
        await tab.goto(origin);
        await expect(tab.locator('#death-screen')).toBeVisible();
        observer = await new Client(origin, { headers: { Origin: origin } }).joinById(
            localWorldRoomId,
        );
        observer.reconnection.enabled = false;
        for (const type of [
            'movement-snapshot',
            'pickup-state',
            'zombie-state',
            'health-state',
            'melee-state',
            'profile-state',
            'melee-action',
        ])
            observer.onMessage(type, () => {});
        await page.getByRole('button', { name: 'Возродиться', exact: true }).dblclick();
        for (const current of [page, tab]) {
            await expect(current.locator('#death-screen')).toBeHidden();
            await expect(current.locator('#health')).toHaveAttribute('data-life-revision', '1');
            await expect(current.locator('#health')).toHaveAttribute('value', '100');
            await expect(current.locator('#inventory')).toHaveText('Контейнер: предметов 0');
            await expect(current.locator('#player-name')).toHaveText('Имя: Вернувшийся');
        }
        const read = () =>
            page.getByRole('status').evaluate(element => ({
                x: Number(element.dataset.xMeters),
                y: Number(element.dataset.yMeters),
                tick: Number(element.dataset.tick),
            }));
        const before = await read();
        for (const lifeRevision of [0, undefined]) {
            observer.send('movement-target', {
                type: 'movement-target',
                protocolVersion: 5,
                sequence: 999,
                target: { xMeters: 30, yMeters: 30 },
                isSprinting: true,
                isSneaking: false,
                lifeRevision,
            });
            observer.send('respawn-player', {
                type: 'respawn-player',
                protocolVersion: 5,
                lifeRevision: 0,
            });
            observer.send('pickup-item', {
                type: 'pickup-item',
                protocolVersion: 5,
                itemId: `${playerId}:knife`,
                lifeRevision,
            });
        }
        await expect.poll(async () => (await read()).tick).toBeGreaterThan(before.tick + 4);
        expect(await read()).toMatchObject({ x: before.x, y: before.y });
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 0');
        await page.getByRole('heading', { name: 'ZombiSurvive', exact: true }).click();
        await page.keyboard.down('d');
        await expect.poll(async () => (await read()).x).toBeGreaterThan(0.7);
        await page.keyboard.up('d');
        const knife = page
            .locator('#corpse-items button')
            .filter({ hasText: 'Забрать с тела: Нож' });
        await expect(knife).toBeEnabled();
        await knife.click();
        await expect(knife).toHaveCount(0);
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await expect(tab.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await page.reload();
        await expect(page.locator('#health')).toHaveAttribute('data-life-revision', '1');
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
        await page.screenshot({ path: '.cache/t034-respawn-return.png', fullPage: true });
        running.host.kill('SIGKILL');
        await running.exited;
        observer.connection.close();
        observer = undefined;
        const saved = new SoloWorldStore(path);
        expect(saved.initialCombat.lifeRevision).toBe(1);
        expect(saved.initialCombat.health).toBeGreaterThan(0);
        expect(saved.initialCorpses).toHaveLength(1);
        expect(
            saved.initialItemLocations.filter(location => location.type === 'corpse'),
        ).toHaveLength(3);
        expect(
            saved.initialItemLocations.filter(location => location.type === 'container'),
        ).toHaveLength(1);
        expect(saved.initialWorld.displayName).toBe('Вернувшийся');
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#health')).toHaveAttribute('data-life-revision', '1');
        await expect(page.locator('#death-screen')).toBeHidden();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 1');
    } finally {
        observer?.connection.close();
        await tab?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
