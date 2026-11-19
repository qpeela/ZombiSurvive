import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import {
    lootRestockSettings,
    medicalOutpost,
    worldGenerationSettings,
} from '@zombi-survive/content';
import { copyItem } from '@zombi-survive/domain';
import { generateChunkLoot } from '@zombi-survive/worldgen';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { movePlayerTo } from '../fixtures/game-controls.mjs';
import { clickEquipmentAction, openInventory } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3152';
const start = path => {
    const env = { ...process.env, PORT: '3152', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = fork('tests/fixtures/world-clock-host.mjs', {
        env,
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    const checkpoints = [];
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    host.on('message', message => {
        if (message.type === 'clock-checkpoint') checkpoints.push(message.worldTimeMs);
    });
    const exited = new Promise(resolve => host.once('exit', resolve));
    return { host, exited, output: () => output, checkpoints };
};
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill('SIGTERM');
    await running.exited;
};
const open = async page => {
    await page.goto(origin);
    await expect(page.locator('#world-time')).toHaveAttribute('data-world-ms', /^\d+$/);
};

const enter = async page => {
    for (const position of [
        { xMeters: 58, yMeters: 8 },
        { xMeters: 68, yMeters: 8 },
        { xMeters: 68, yMeters: 4 },
        medicalOutpost.bandagePosition,
    ])
        await movePlayerTo({ page, position });
};

test('the player recognizes the outpost, enters through the existing southern gap and retains its collected bandage and deadline after restart', async ({
    page,
}) => {
    test.setTimeout(45000);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-medical-route-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    seed.savePosition({ xMeters: 48, yMeters: 8 });
    seed.close();
    let running = start(path);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await page.locator('canvas').screenshot({ path: '.cache/t060-outpost-route.png' });
        await enter(page);
        const pickup = page.getByRole('button', { name: 'Взять: Бинт', exact: true });
        await expect(pickup).toBeEnabled();
        await page.locator('canvas').screenshot({ path: '.cache/t060-outpost-inside.png' });
        await pickup.click();
        await expect(pickup).toBeHidden();
        await expect(page.locator('#restock-label')).toContainText('Бинт');
        await page.reload();
        await expect(page.locator('#restock-label')).toContainText('Бинт');
        await stop(running);
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(
                location => location.item.itemId === medicalOutpost.bandageItemId,
            )?.type,
        ).toBe('container');
        const deadline = saved.initialLootRestocks.get(medicalOutpost.bandageItemId);
        expect(deadline).toBeGreaterThan(lootRestockSettings.periodWorldMs);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await expect(pickup).toBeHidden();
        await expect(page.locator('#restock-label')).toContainText('Бинт');
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('the empty host replenishes one medical bandage after multiple missed periods; the return route collects it beside the preserved old instance', async ({
    page,
}) => {
    test.setTimeout(45000);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-medical-restock-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    const loot = generateChunkLoot({
        seed: worldGenerationSettings.initialSeed,
        generatorVersion: 1,
        chunkX: 1,
        chunkY: 0,
    });
    const period = lootRestockSettings.periodWorldMs;
    seed.saveItemLocations(
        [
            ...seed.initialItemLocations,
            ...loot.map(item =>
                item.itemId === medicalOutpost.bandageItemId
                    ? {
                          type: 'container',
                          item: copyItem(item),
                          playerId: seed.initialWorld.playerId,
                          cell: { column: 0, row: 0 },
                      }
                    : { type: 'ground', item },
            ),
        ],
        { worldTimeMs: period * 4, restocks: new Map([[medicalOutpost.bandageItemId, period]]) },
    );
    seed.savePosition({ xMeters: 48, yMeters: 8 });
    seed.close();
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await expect.poll(() => running.checkpoints.at(-1) ?? -1).toBeGreaterThan(period * 4);
        await stop(running);
        const saved = new SoloWorldStore(path);
        const fresh = saved.initialItemLocations.filter(location =>
            location.item.itemId.startsWith(`${medicalOutpost.bandageItemId}:restock:`),
        );
        expect(fresh).toHaveLength(1);
        expect(fresh[0].type).toBe('ground');
        expect(
            saved.initialItemLocations.find(
                location => location.item.itemId === medicalOutpost.bandageItemId,
            )?.type,
        ).toBe('container');
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await enter(page);
        // The first bandage fills the 2 kg bag; holding the axe makes room for the replacement.
        await clickEquipmentAction(page, 'Экипировать топор');
        const pickup = page.getByRole('button', { name: 'Взять: Бинт', exact: true });
        await expect(pickup).toBeEnabled();
        await pickup.click();
        await expect(page.locator('#equipment-weight')).toContainText('2100');
        // Two bandages must remain individually selectable, just like duplicate weapons.
        await openInventory(page);
        const secondBandage = page.locator(
            `#inventory-items button[data-item-id="${fresh[0].item.itemId}"]`,
        );
        await secondBandage.click();
        await page.getByRole('button', { name: 'Ячейка 1, 3', exact: true }).click();
        await expect(secondBandage).toContainText('ячейка 1, 3');
        await page.reload();
        await expect(secondBandage).toContainText('ячейка 1, 3');
        await expect(page.locator('#equipment-weight')).toContainText('2100');
        await expect(page.getByRole('button', { name: 'Взять: Бинт', exact: true })).toBeHidden();
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('using the medical bandage stops bleeding without healing and its consumed instance stays absent from the bag after host restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-medical-use-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    const loot = generateChunkLoot({
        seed: worldGenerationSettings.initialSeed,
        generatorVersion: 1,
        chunkX: 1,
        chunkY: 0,
    });
    seed.saveItemLocations([
        ...seed.initialItemLocations,
        ...loot.map(item =>
            item.itemId === medicalOutpost.bandageItemId
                ? {
                      type: 'container',
                      item: copyItem(item),
                      playerId: seed.initialWorld.playerId,
                      cell: { column: 0, row: 0 },
                  }
                : { type: 'ground', item },
        ),
    ]);
    seed.saveCombat(
        { health: 70, cooldownTicks: 0, bleedingTicks: 100 },
        undefined,
        medicalOutpost.bandagePosition,
    );
    seed.close();
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        const use = page.getByRole('button', { name: 'Использовать бинт', exact: true });
        await expect(use).toBeEnabled();
        await use.click();
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
        await expect(use).toBeDisabled();
        const health = Number(await page.locator('#health').getAttribute('value'));
        expect(health).toBeGreaterThan(0);
        expect(health).toBeLessThanOrEqual(70);
        await stop(running);
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(
                location => location.item.itemId === medicalOutpost.bandageItemId,
            ),
        ).toEqual({
            type: 'consumed',
            item: { itemId: medicalOutpost.bandageItemId, kind: 'bandage' },
        });
        expect(saved.initialCombat.health).toBe(health);
        expect(saved.initialCombat.bleedingTicks).toBe(0);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await open(page);
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 4');
        await expect(use).toBeDisabled();
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
