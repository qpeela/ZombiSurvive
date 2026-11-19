import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { meleeWeapons, worldGenerationSettings } from '@zombi-survive/content';
import { localWorldRoomId } from '@zombi-survive/protocol';
import { generateChunkLoot } from '@zombi-survive/worldgen';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { clickWorld, movePlayerTo } from '../fixtures/game-controls.mjs';
import { clickEquipmentAction, openInventory } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3137';
const lootFor = (chunkX, chunkY) =>
    generateChunkLoot({
        seed: worldGenerationSettings.initialSeed,
        generatorVersion: 1,
        chunkX,
        chunkY,
    });
const start = path => {
    const env = { ...process.env, PORT: '3137', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
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
const stop = async (running, signal = 'SIGTERM') => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill(signal);
    return running.exited;
};

const waitForIdleCamera = async page => {
    await expect(page.getByRole('status')).toHaveAttribute('data-noise-radius', '0');
    // The stop acknowledgement can precede the last visual prediction
    // correction. Map the next click only after the camera has settled.
    await expect
        .poll(() =>
            page.locator('canvas').evaluate(canvas => {
                const status = canvas.ownerDocument.querySelector('#connection-status');
                return Math.hypot(
                    (Number(canvas.dataset.playerX) - 480) / 24 -
                        Number(status?.getAttribute('data-x-meters')),
                    (Number(canvas.dataset.playerY) - 270) / 24 -
                        Number(status?.getAttribute('data-y-meters')),
                );
            }),
        )
        .toBeLessThan(0.01);
};

test('walking into a new northern chunk discovers weapon and ammo once; pickup, both tabs and crash/restart retain their instances', async ({
    page,
    context,
}) => {
    test.setTimeout(60000);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-chunk-walk-'));
    const path = join(directory, 'world.sqlite');
    let running = start(path);
    let second;
    const loot = lootFor(0, -1);
    const weapon = loot.find(item => item.kind !== 'ammo9mm');
    const ammo = loot.find(item => item.kind === 'ammo9mm');
    expect(weapon).toBeDefined();
    expect(ammo).toBeDefined();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await clickEquipmentAction(page, 'Экипировать топор');
        await page.locator('canvas').scrollIntoViewIfNeeded();
        await page.keyboard.down('Shift');
        await page.keyboard.down('w');
        try {
            await expect
                .poll(
                    async () =>
                        Number(await page.getByRole('status').getAttribute('data-y-meters')),
                    { timeout: 12000 },
                )
                .toBeLessThan(-40);
        } finally {
            await page.keyboard.up('w');
            await page.keyboard.up('Shift');
        }
        for (const position of [
            { xMeters: 6, yMeters: -49 },
            { xMeters: 10, yMeters: -58 },
            { xMeters: 10, yMeters: -67 },
            weapon.position,
        ]) {
            await waitForIdleCamera(page);
            await movePlayerTo({ page, position });
        }
        await expect(page.locator('#pickup')).toHaveAccessibleName('Взять: Дубинка');
        await page.screenshot({ path: '.cache/t039a-chunk-discovery.png', fullPage: true });
        await page.locator('#pickup').click();
        await waitForIdleCamera(page);
        await movePlayerTo({ page, position: ammo.position });
        await page.getByRole('button', { name: 'Взять: Патроны 9 мм ×8', exact: true }).click();
        await expect(
            page.locator(`#inventory-items button[data-item-id="${ammo.itemId}"]`),
        ).toContainText('×8');
        await openInventory(page);
        await page.locator(`#inventory-items button[data-item-id="${weapon.itemId}"]`).click();
        await clickEquipmentAction(page, meleeWeapons[weapon.kind].equipLabel);
        await expect(page.locator('canvas')).toHaveAttribute('data-weapon', weapon.kind);
        await stop(running, 'SIGKILL');
        let saved = new SoloWorldStore(path);
        expect(saved.initialItemLocations).toHaveLength(21);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === weapon.itemId),
        ).toMatchObject({ type: 'hands' });
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammo.itemId),
        ).toMatchObject({ type: 'container', item: { quantity: 8 } });
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('canvas')).toHaveAttribute('data-weapon', weapon.kind);
        second = await context.newPage();
        await second.goto(origin);
        await expect(
            second.locator(`#inventory-items button[data-item-id="${ammo.itemId}"]`),
        ).toContainText('×8');
        await page.reload();
        await expect(page.locator('#ground-item')).toHaveText('На земле: пусто');
        await stop(running);
        saved = new SoloWorldStore(path);
        expect(saved.initialItemLocations).toHaveLength(21);
        saved.close();
        expect(errors).toEqual([]);
    } finally {
        await second?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a new chunk pistol uses its scattered pack for a real reload and keeps the partial pack after restart', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-chunk-reload-'));
    const path = join(directory, 'world.sqlite');
    const loot = lootFor(-1, 1);
    const weapon = loot.find(item => item.kind === 'pistol');
    const ammo = loot.find(item => item.kind === 'ammo9mm');
    expect(weapon).toBeDefined();
    expect(ammo).toBeDefined();
    const store = new SoloWorldStore(path);
    store.savePosition(weapon.position);
    store.saveItemLocations(
        store.initialItemLocations.map(location =>
            location.type === 'container' ? { type: 'expired', item: location.item } : location,
        ),
    );
    store.close();
    let running = start(path);
    let second;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await page.getByRole('button', { name: 'Взять: Пистолет 9 мм', exact: true }).click();
        await clickEquipmentAction(page, 'Экипировать пистолет');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await waitForIdleCamera(page);
        await movePlayerTo({ page, position: ammo.position });
        await page.getByRole('button', { name: 'Взять: Патроны 9 мм ×8', exact: true }).click();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await clickWorld({
            page,
            position: { xMeters: weapon.position.xMeters - 10, yMeters: weapon.position.yMeters },
            button: 'right',
        });
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await page.keyboard.press('r');
        await expect(page.locator('#reload-progress')).toBeVisible();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(
            page.locator(`#inventory-items button[data-item-id="${ammo.itemId}"]`),
        ).toContainText('×7');
        await page.screenshot({ path: '.cache/t039a-chunk-reloaded.png', fullPage: true });
        await stop(running, 'SIGKILL');
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === weapon.itemId),
        ).toMatchObject({ type: 'hands', item: { rounds: 8, revision: 2 } });
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammo.itemId),
        ).toMatchObject({ type: 'container', item: { quantity: 7 } });
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        second = await context.newPage();
        await second.goto(origin);
        for (const current of [page, second]) {
            await expect(
                current.locator(`#inventory-items button[data-item-id="${ammo.itemId}"]`),
            ).toContainText('×7');
            await expect(current.locator('#ground-item')).toHaveText('На земле: пусто');
        }
    } finally {
        await second?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a nearly full bag can reach the separate ammo pack without taking the heavier weapon and reload an already held pistol', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-chunk-full-bag-'));
    const path = join(directory, 'world.sqlite');
    const ammo = lootFor(1, 0)[0];
    if (ammo?.kind !== 'ammo9mm') throw new Error('Missing separate ammo fixture');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    store.savePosition(ammo.position);
    store.saveItemLocations(
        store.initialItemLocations.map(location =>
            location.item.itemId === 'pistol-v1:0:0'
                ? {
                      type: 'hands',
                      playerId,
                      item: {
                          itemId: location.item.itemId,
                          kind: 'pistol',
                          rounds: 7,
                          magazineCapacity: 8,
                      },
                  }
                : location,
        ),
    );
    store.close();
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await page.getByRole('button', { name: 'Взять: Патроны 9 мм ×8', exact: true }).click();
        await expect(
            page.locator(`#inventory-items button[data-item-id="${ammo.itemId}"]`),
        ).toContainText('×8');
        await page.locator('#game').focus();
        await page.keyboard.press('r');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(
            page.locator(`#inventory-items button[data-item-id="${ammo.itemId}"]`),
        ).toContainText('×7');
        await expect(page.locator('#pickup')).toBeDisabled();
        await expect(page.locator('#ground-item')).toHaveText('На земле: Дубинка · 54, -8 м');
        await page.screenshot({ path: '.cache/t039a-ammo-with-full-bag.png', fullPage: true });
        await stop(running, 'SIGKILL');
        const saved = new SoloWorldStore(path);
        expect(saved.initialItemLocations).toHaveLength(21);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammo.itemId),
        ).toMatchObject({ type: 'container', item: { quantity: 7 } });
        expect(
            saved.initialItemLocations.find(
                location => location.item.itemId === 'loot-v1:1:0:club',
            ),
        ).toMatchObject({ type: 'ground' });
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(
            page.locator(`#inventory-items button[data-item-id="${ammo.itemId}"]`),
        ).toContainText('×7');
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('failed first chunk registration stops the real host before publishing generated loot and preserves the old manifest', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-chunk-failure-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const spawn = lootFor(0, -1)[0];
    if (spawn === undefined) throw new Error('Missing registration fixture loot');
    store.savePosition(spawn.position);
    store.close();
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_chunk BEFORE UPDATE OF loot_chunks ON solo_world WHEN NEW.loot_chunks != '[]' BEGIN SELECT RAISE(ABORT, 'chunk disk failure'); END",
    );
    database.close();
    const running = start(path);
    let room;
    const pickups = [];
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await new Client(origin, { headers: { Origin: origin } }).joinById(localWorldRoomId);
        room.reconnection.enabled = false;
        room.onMessage('pickup-state', state => pickups.push(state));
        for (const type of [
            'movement-snapshot',
            'health-state',
            'zombie-state',
            'melee-state',
            'firearm-state',
            'profile-state',
        ])
            room.onMessage(type, () => {});
        expect(await running.exited).toEqual({ code: 1, signal: null });
        expect(running.output()).toContain('Solo save failed; stopping host: chunk disk failure');
        expect(pickups.some(state => state.groundItem?.itemId?.startsWith('chunk-loot-v1:'))).toBe(
            false,
        );
        const saved = new SoloWorldStore(path);
        expect(saved.initialItemLocations).toHaveLength(19);
        saved.close();
        const raw = new DatabaseSync(path);
        expect(raw.prepare('SELECT loot_chunks FROM solo_world').get().loot_chunks).toBe('[]');
        raw.close();
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
