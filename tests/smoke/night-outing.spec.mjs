import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { medicalOutpost, meleeWeapons } from '@zombi-survive/content';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import {
    activateStartingZombie,
    aimWorld,
    distanceToStartingZombie,
    movePlayerTo,
} from '../fixtures/game-controls.mjs';

const origin = 'http://127.0.0.1:3154';
const route = [
    { xMeters: 4, yMeters: 0 },
    { xMeters: 4, yMeters: 10 },
    { xMeters: 18, yMeters: 10 },
    { xMeters: 32, yMeters: 10 },
    { xMeters: 46, yMeters: 10 },
    { xMeters: 60, yMeters: 10 },
    { xMeters: 68, yMeters: 10 },
];
const start = path => {
    const env = { ...process.env, PORT: '3154', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [host.stdout, host.stderr]) {
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    }
    const exited = new Promise(resolve =>
        host.once('exit', (code, signal) => resolve({ code, signal })),
    );

    return { host, exited, output: () => output };
};
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null) {
        running.host.kill('SIGTERM');
    }
    expect(await running.exited).toEqual({ code: 0, signal: null });
};
const readSave = path => {
    const store = new SoloWorldStore(path);
    try {
        return {
            world: store.initialWorld,
            combat: store.initialCombat,
            worldTimeMs: store.initialWorldTimeMs,
            zombieHealth: [...store.initialZombieHealth].sort(),
            zombiePositions: [...store.initialZombiePositions].sort(),
            items: store.initialItemLocations,
            restocks: [...store.initialLootRestocks].sort(),
        };
    } finally {
        store.close();
    }
};
const health = async page => Number(await page.locator('#health').getAttribute('value'));

test('depart at dusk, find the medical bandage by torch at night, survive combat, return and retain all four outcomes after host restart', async ({
    page,
}) => {
    // The real round trip is about 160 m; the host naturally crosses dusk into night.
    test.setTimeout(120000);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-night-outing-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    seed.savePosition({ xMeters: 0, yMeters: 0 }, 12 * 3_600_000 - 900_000);
    seed.close();
    let running = start(path);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        const status = page.getByRole('status');
        const canvas = page.locator('canvas');
        await expect(status).toHaveAttribute('data-status', 'connected');
        await expect(canvas).toHaveAttribute('data-daylight-phase', 'dusk');
        await page.getByRole('button', { name: 'Экипировать дубинку', exact: true }).click();
        const departureTime = await page.locator('#world-time').innerText();
        for (const position of route) {
            await movePlayerTo({ page, position });
        }
        await movePlayerTo({ page, position: medicalOutpost.entrance });
        await expect(canvas).toHaveAttribute('data-daylight-phase', 'night', { timeout: 25000 });
        const pickup = page.getByRole('button', { name: 'Подобрать бинт', exact: true });
        await expect(pickup).toBeHidden();
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'false');
        await page.locator('#flashlight').click();
        await aimWorld({ page, position: medicalOutpost.bandagePosition });
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'true');
        await expect(pickup).toBeVisible();
        await expect(pickup).toBeDisabled();
        await canvas.screenshot({ path: '.cache/t061-night-medical-beam.png' });
        await movePlayerTo({ page, position: { xMeters: 68, yMeters: 4 } });
        await movePlayerTo({ page, position: medicalOutpost.bandagePosition });
        await expect(pickup).toBeEnabled();
        await pickup.click();
        await expect(pickup).toBeHidden();
        await expect(page.locator('#restock-label')).toContainText('Бинт');
        await movePlayerTo({ page, position: { xMeters: 68, yMeters: 4 } });
        for (const position of [...route].reverse()) {
            await movePlayerTo({ page, position });
        }
        await movePlayerTo({ page, position: { xMeters: 0, yMeters: 0 } });
        await activateStartingZombie(page);
        await expect
            .poll(() => distanceToStartingZombie(page), { timeout: 10000 })
            .toBeLessThan(1.1);
        await expect.poll(() => health(page)).toBeLessThan(100);
        for (const damage of [34, 34, 32]) {
            await page.locator('#melee-attack').click();
            await expect
                .poll(() =>
                    canvas.evaluate(
                        element => JSON.parse(element.dataset.meleeEffects ?? '[]').at(-1)?.impact,
                    ),
                )
                .toMatchObject({ zombieId: 'slow-zombie-1', damage });
            const tick = Number(await status.getAttribute('data-tick'));
            await expect
                .poll(async () => Number(await status.getAttribute('data-tick')))
                .toBeGreaterThanOrEqual(tick + meleeWeapons.club.cooldownTicks + 1);
        }
        const woundedHealth = await health(page);
        expect(woundedHealth).toBeGreaterThan(0);
        const use = page.locator('#use-bandage');
        if (await use.isEnabled()) {
            await use.click();
        }
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
        expect(await health(page)).toBeLessThanOrEqual(woundedHealth);
        // The return marker is quantized to CSS pixels, as in movePlayerTo.
        expect(
            Math.hypot(
                Number(await status.getAttribute('data-x-meters')),
                Number(await status.getAttribute('data-y-meters')),
            ),
        ).toBeLessThan(0.05);
        const returned = {
            health: await health(page),
            time: await page.locator('#world-time').innerText(),
            worldTimeMs: Number(await page.locator('#world-time').getAttribute('data-world-ms')),
            inventory: await page.locator('#inventory').innerText(),
        };
        await page.screenshot({ path: '.cache/t061-returned.png', fullPage: true });
        await stop(running);
        const before = readSave(path);
        expect(before.combat.health).toBe(returned.health);
        expect(before.combat.bleedingTicks).toBe(0);
        expect(before.worldTimeMs).toBeGreaterThanOrEqual(returned.worldTimeMs);
        expect(before.zombieHealth).toContainEqual(['slow-zombie-1', 0]);
        const bandage = before.items.find(
            location => location.item.itemId === medicalOutpost.bandageItemId,
        );
        expect(['container', 'consumed']).toContain(bandage?.type);
        // Reading a stopped save must not advance any of the four outcomes.
        expect(readSave(path)).toEqual(before);
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(status).toHaveAttribute('data-player-id', before.world.playerId);
        await expect(page.locator('#health')).toHaveAttribute(
            'value',
            String(before.combat.health),
        );
        await expect(page.locator('#bleeding-label')).toHaveText('Кровотечение: нет');
        await expect(page.locator('#inventory')).toHaveText(returned.inventory);
        await expect(canvas).toHaveAttribute('data-daylight-phase', 'night');
        await expect
            .poll(async () =>
                Number(await page.locator('#world-time').getAttribute('data-world-ms')),
            )
            .toBeGreaterThanOrEqual(before.worldTimeMs);
        await expect
            .poll(() =>
                canvas.evaluate(element =>
                    JSON.parse(element.dataset.zombies ?? '[]').some(
                        zombie => zombie.zombieId === 'slow-zombie-1',
                    ),
                ),
            )
            .toBe(false);
        await stop(running);
        const after = readSave(path);
        expect(after.world).toEqual(before.world);
        expect(after.combat).toEqual(before.combat);
        expect(after.zombieHealth).toEqual(before.zombieHealth);
        expect(after.zombiePositions).toEqual(before.zombiePositions);
        expect(after.items).toEqual(before.items);
        expect(after.restocks).toEqual(before.restocks);
        expect(after.worldTimeMs).toBeGreaterThanOrEqual(before.worldTimeMs);
        writeFileSync(
            '.cache/t061-acceptance.json',
            JSON.stringify({ departureTime, returned, before, after }, null, 2),
        );
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
