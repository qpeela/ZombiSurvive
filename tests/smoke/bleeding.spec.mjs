import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { localWorldRoomId } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3125';
const seed = path => {
    const store = new SoloWorldStore(path);
    store.savePosition({ xMeters: 8, yMeters: 12 });
    store.saveCombat({ health: 70, cooldownTicks: 0, bleedingTicks: 100 });
    store.close();
};
const start = path => {
    const env = { ...process.env, PORT: '3125', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const open = async page => {
    await page.goto(origin);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: есть');
};

test('wound survives tabs, reload, retry and SIGKILL after periodic damage; stopped host retains its interval', async ({
    page,
    context,
    browser,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-wound-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    let running = start(path);
    let tab;
    let observer;
    let fresh;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        tab = await context.newPage();
        await open(tab);
        await page.reload();
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: есть');
        await context.setOffline(true);
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: —');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: есть');
        await page.screenshot({ path: '.cache/t030-bleeding-hud.png', fullPage: true });
        observer = await new Client(origin, { headers: { Origin: origin } }).joinById(
            localWorldRoomId,
        );
        observer.reconnection.enabled = false;
        for (const type of [
            'movement-snapshot',
            'pickup-state',
            'zombie-state',
            'melee-state',
            'profile-state',
            'melee-action',
        ])
            observer.onMessage(type, () => {});
        const damaged = new Promise(resolve =>
            observer.onMessage('health-state', state => {
                if (state.health < 70 && state.bleedingTicks === 100) {
                    running.host.kill('SIGKILL');
                    resolve(state);
                }
            }),
        );
        const confirmed = await damaged;
        await running.exited;
        observer.connection.close();
        observer = undefined;
        const stored = new SoloWorldStore(path);
        const saved = stored.initialCombat;
        expect(saved).toEqual({ health: confirmed.health, cooldownTicks: 0, bleedingTicks: 100 });
        stored.close();
        // Reopening a stopped host's file never advances simulation time.
        const stopped = new SoloWorldStore(path);
        expect(stopped.initialCombat).toEqual(saved);
        stopped.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        fresh = await browser.newContext();
        const restored = await fresh.newPage();
        await open(restored);
        const restoredHealth = Number(await restored.locator('#health').getAttribute('value'));
        expect(restoredHealth).toBeGreaterThan(0);
        expect(restoredHealth).toBeLessThanOrEqual(saved.health);
        await expect(restored.locator('#health-label')).toHaveText(
            `Здоровье: ${restoredHealth - 1} / 100`,
            { timeout: 8000 },
        );
        expect(errors).toEqual([]);
    } finally {
        observer?.connection.close();
        await tab?.close();
        await fresh?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('wound countdown without players stops the real host on failed commit and preserves the previous interval', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-wound-failure-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    const database = new DatabaseSync(path);
    database.exec(`CREATE TRIGGER reject_wound BEFORE UPDATE OF combat_state ON solo_world
        BEGIN SELECT RAISE(ABORT, 'wound disk failure'); END`);
    database.close();
    const running = start(path);
    try {
        expect(await running.exited).toEqual({ code: 1, signal: null });
        expect(running.output()).toContain('Solo save failed; stopping host: wound disk failure');
        const restored = new SoloWorldStore(path);
        expect(restored.initialCombat).toEqual({
            health: 70,
            cooldownTicks: 0,
            bleedingTicks: 100,
        });
        restored.close();
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
