import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { firearmVersion, localWorldRoomId, protocolVersion } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3133';
const start = path => {
    const env = { ...process.env, PORT: '3133', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
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
const stop = async (running, signal = 'SIGTERM') => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill(signal);
    await running.exited;
};
const seed = (path, rounds) => {
    const store = new SoloWorldStore(path);
    const gun = store.initialItemLocations.find(location => location.item.kind === 'pistol')?.item;
    if (gun === undefined) throw new Error('Missing gun');
    store.saveItemLocations(
        store.initialItemLocations.map(location =>
            location.item.itemId === gun.itemId
                ? {
                      type: 'hands',
                      playerId: store.initialWorld.playerId,
                      item: { itemId: gun.itemId, kind: 'pistol', rounds, magazineCapacity: 8 },
                  }
                : location,
        ),
    );
    store.close();
    return gun.itemId;
};
const waitCooldown = async page => {
    const status = page.getByRole('status');
    const tick = Number(await status.getAttribute('data-tick'));
    await expect
        .poll(async () => Number(await status.getAttribute('data-tick')))
        .toBeGreaterThanOrEqual(tick + 11);
};

test('RMB, Space and HUD each shoot once; typing and key repeat do not shoot, empty refuses, LMB still moves', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-shot-ui-'));
    const path = join(directory, 'world.sqlite');
    seed(path, 3);
    const running = start(path);
    let tab;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        tab = await context.newPage();
        await tab.goto(origin);
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await page.bringToFront();
        const canvas = page.locator('canvas');
        await canvas.scrollIntoViewIfNeeded();
        await canvas.click({ button: 'right', position: { x: 600, y: 260 } });
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 2/8');
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 2/8');
        await expect(canvas).toHaveAttribute('data-target-visible', 'false');
        await expect
            .poll(() =>
                canvas.evaluate(canvas =>
                    JSON.parse(canvas.dataset.shotEffects ?? '[]').map(
                        effect => effect.action.impact.outcome,
                    ),
                ),
            )
            .toContain('miss');
        await waitCooldown(page);
        await page.keyboard.down('Space');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 1/8');
        await waitCooldown(page);
        await page.keyboard.down('Space');
        await page.keyboard.up('Space');
        await waitCooldown(page);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 1/8');
        const name = page.locator('#display-name');
        await name.focus();
        await page.keyboard.press('Space');
        await waitCooldown(page);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 1/8');
        await page.locator('#pistol-shot').click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await expect(page.locator('#pistol-shot')).toBeDisabled();
        await page.screenshot({ path: '.cache/t037-pistol-shot.png', fullPage: true });
        await canvas.click({ button: 'right', position: { x: 600, y: 260 } });
        await page.keyboard.press('Space');
        await waitCooldown(page);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await canvas.click({ position: { x: 550, y: 270 } });
        await expect(canvas).toHaveAttribute('data-target-visible', 'true');
        await expect
            .poll(async () => Number(await canvas.getAttribute('data-player-x')))
            .toBeGreaterThan(490);
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        expect(errors).toEqual([]);
    } finally {
        await tab?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('first acknowledged hit survives immediate SIGKILL; old revision retry after restart cannot spend again', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-shot-crash-'));
    const path = join(directory, 'world.sqlite');
    const itemId = seed(path, 8);
    let running = start(path);
    let room;
    const connect = async () => {
        const joined = await new Client(origin, { headers: { Origin: origin } }).joinById(
            localWorldRoomId,
        );
        joined.reconnection.enabled = false;
        for (const type of [
            'movement-snapshot',
            'pickup-state',
            'zombie-state',
            'health-state',
            'melee-state',
            'profile-state',
            'melee-action',
            'shot-action',
        ])
            joined.onMessage(type, () => {});
        return joined;
    };
    const command = {
        type: 'shoot-pistol',
        protocolVersion,
        firearmVersion,
        itemId,
        weaponRevision: 0,
        aim: { x: -1, y: 0 },
    };
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        let tick = 0;
        room.onMessage('movement-snapshot', state => {
            tick = state.tick;
        });
        await expect.poll(() => tick).toBeGreaterThan(0);
        let acknowledged;
        room.onMessage('shot-action', action => {
            acknowledged = action;
            running.host.kill('SIGKILL');
        });
        room.send('shoot-pistol', command);
        await running.exited;
        expect(acknowledged).toMatchObject({
            weaponRevision: 1,
            impact: { outcome: 'hit', zombieId: 'slow-zombie-1', damage: 30 },
        });
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === itemId),
        ).toMatchObject({ type: 'hands', item: { rounds: 7, revision: 1 } });
        expect(saved.initialCombat.cooldownTicks).toBeGreaterThan(0);
        expect(saved.initialCombat.cooldownTicks).toBeLessThanOrEqual(10);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        let state;
        let latestTick = 0;
        let shots = 0;
        room.onMessage('pickup-state', value => {
            state = value;
        });
        room.onMessage('movement-snapshot', value => {
            latestTick = value.tick;
        });
        room.onMessage('shot-action', () => {
            shots++;
        });
        await expect.poll(() => latestTick).toBeGreaterThan(12);
        room.send('shoot-pistol', command);
        const sentTick = latestTick;
        await expect.poll(() => latestTick).toBeGreaterThan(sentTick + 3);
        expect(shots).toBe(0);
        expect(state.hands).toMatchObject({ rounds: 7, revision: 1 });
        room.send('shoot-pistol', { ...command, weaponRevision: 1 });
        await expect.poll(() => shots).toBe(1);
        await expect.poll(() => state?.hands?.rounds).toBe(6);
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('confirmed UI hits and kill show actual damage against the aimed zombie', async ({ page }) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-shot-hit-'));
    const path = join(directory, 'world.sqlite');
    seed(path, 8);
    const running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        const canvas = page.locator('canvas');
        for (let shot = 1; shot <= 4; shot++) {
            await canvas.scrollIntoViewIfNeeded();
            const point = await canvas.evaluate(canvas => {
                const target = JSON.parse(canvas.dataset.zombies ?? '[]').find(
                    zombie => zombie.zombieId === 'slow-zombie-1',
                );
                if (target === undefined) return null;
                const box = canvas.getBoundingClientRect();
                return {
                    x:
                        ((480 + target.position.xMeters * 24 - Number(canvas.dataset.cameraX)) *
                            box.width) /
                        960,
                    y:
                        ((270 + target.position.yMeters * 24 - Number(canvas.dataset.cameraY)) *
                            box.height) /
                        540,
                };
            });
            expect(point).not.toBeNull();
            await canvas.click({ button: 'right', position: point });
            await expect(page.locator('#ammo-label')).toHaveText(`Патроны: ${8 - shot}/8`);
            const outcome = shot === 4 ? 'kill' : 'hit';
            await expect
                .poll(() =>
                    canvas.evaluate(
                        (canvas, outcome) =>
                            JSON.parse(canvas.dataset.shotEffects ?? '[]').find(
                                effect => effect.action.impact.outcome === outcome,
                            )?.action.impact.damage,
                        outcome,
                    ),
                )
                .toBe(shot === 4 ? 10 : 30);
            if (shot < 4) await waitCooldown(page);
        }
        await page.screenshot({ path: '.cache/t037-hit-kill.png', fullPage: true });
        await expect
            .poll(() =>
                canvas.evaluate(canvas =>
                    JSON.parse(canvas.dataset.zombies ?? '[]').some(
                        zombie => zombie.zombieId === 'slow-zombie-1',
                    ),
                ),
            )
            .toBe(false);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
