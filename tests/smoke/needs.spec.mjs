import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import {
    coldSettings,
    fatigueSettings,
    hungerSettings,
    movementSettings,
    rationLoot,
    restSettings,
    thirstSettings,
    weatherSettings,
    workshopBench,
    workshopCanopy,
    workshopWater,
} from '@zombi-survive/content';

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
    store.savePosition(workshopWater.item.position, 0, {
        thirstMs: 5 * 3_600_000,
        hungerMs: 0,
        fatigueMs: 0,
    });
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
        fatigueMs: 0,
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
            fatigueMs: 0,
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

test('high awake fatigue limits stamina after reconnect and host restart', async ({ page }) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-fatigue-smoke-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    store.savePosition(store.initialWorld.position, 0, {
        thirstMs: 0,
        hungerMs: 0,
        fatigueMs: 18 * 3_600_000,
    });
    store.close();
    let host = startHost(path);
    const fatigue = page.locator('#fatigue-status');
    const meter = page.locator('#stamina');
    const checkCap = async () => {
        await expect(fatigue).toHaveText(/^Усталость: 7[5-9]% · Максимум выносливости 65%$/);
        await expect(fatigue).toBeVisible();
        await expect(meter).toHaveJSProperty('value', fatigueSettings.maximumStamina);
    };
    try {
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        await checkCap();
        await page.reload();
        await checkCap();
        await host.stop('SIGTERM');
        host = startHost(path);
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        await checkCap();
    } finally {
        await host.stop('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
    }
});

const startBenchRest = async page => {
    await page.goto(origin);
    await expect(page.locator('#fatigue-status')).toContainText('Максимум выносливости 65%');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
    await page.locator('#game').press('e');
    const menu = page.locator('#world-context');
    await expect(menu).toContainText('Скамья у мастерской');
    await menu.getByRole('button', { name: 'Передохнуть', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: 'Передышка' })).toBeVisible();
};

test('bench rest runs on the game clock, lowers fatigue and survives immediate host restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-bench-smoke-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    store.savePosition(workshopBench.position, 0, {
        fatigueMs: 18 * 3_600_000,
        hungerMs: 0,
        thirstMs: 0,
    });
    store.close();
    let host = startHost(path);
    try {
        await expect.poll(host.output).toContain('Local world ready');
        await startBenchRest(page);
        const meter = page.getByRole('progressbar', { name: 'Передышка' });
        await expect(meter).toHaveJSProperty('max', restSettings.durationWorldMs);
        await expect.poll(() => meter.evaluate(progress => progress.value)).toBeGreaterThan(0);
        const status = page.locator('#rest-status');
        const fatigue = page.locator('#fatigue-status');
        await expect(status).toHaveText('Передышка завершена.', { timeout: 12000 });
        await expect(fatigue).toHaveText(/^Усталость: 58%$/);
        await expect(meter).toBeHidden();
        await expect
            .poll(() => page.locator('#stamina').evaluate(progress => progress.value))
            .toBeGreaterThan(fatigueSettings.maximumStamina);

        await host.stop('SIGKILL');
        host = startHost(path);
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(fatigue).toHaveText(/^Усталость: 58%$/);
        await expect(status).toBeHidden();
    } finally {
        await host.stop('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
    }
});

test('bench rest reports movement and control loss without reducing fatigue', async ({ page }) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-bench-cancel-smoke-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    store.savePosition(workshopBench.position, 0, {
        fatigueMs: 18 * 3_600_000,
        hungerMs: 0,
        thirstMs: 0,
    });
    store.close();
    const host = startHost(path);
    try {
        await expect.poll(host.output).toContain('Local world ready');
        await startBenchRest(page);
        await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
        const status = page.locator('#rest-status');
        await expect(status).toHaveText('Передышка прервана из-за потери управления.');
        const fatigue = page.locator('#fatigue-status');
        await expect(fatigue).toContainText('Максимум выносливости 65%');

        await startBenchRest(page);
        try {
            await page.keyboard.down('d');
            await expect(status).toHaveText('Передышка прервана из-за движения.');
        } finally {
            await page.keyboard.up('d');
        }
        await expect(fatigue).toContainText('Максимум выносливости 65%');
    } finally {
        await host.stop('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
    }
});

test('rain wets the player outside the workshop canopy and pauses under it', async ({ page }) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-wetness-smoke-'));
    const path = join(directory, 'world.sqlite');
    const outside = {
        xMeters: workshopCanopy.maxXMeters + 0.75,
        yMeters: workshopBench.position.yMeters,
    };
    const store = new SoloWorldStore(path);
    store.savePosition(outside, weatherSettings.rainStartsAtWorldMs);
    store.close();
    let host = startHost(path);
    const canvas = page.locator('canvas');
    const connection = page.getByRole('status');
    const wetness = page.locator('#wetness-status');
    try {
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(canvas).toHaveAttribute('data-player-visible', 'true');
        await expect(wetness).toBeVisible({ timeout: 10000 });

        const camera = await canvas.evaluate(element => ({
            x: Number(element.dataset.cameraX),
            y: Number(element.dataset.cameraY),
        }));
        const box = await canvas.boundingBox();
        await page.mouse.click(
            box.x + (box.width * (480 + workshopBench.position.xMeters * 24 - camera.x)) / 960,
            box.y + (box.height * (270 + workshopBench.position.yMeters * 24 - camera.y)) / 540,
        );
        await expect
            .poll(async () => Number(await connection.getAttribute('data-x-meters')))
            .toBeLessThan(workshopCanopy.maxXMeters - 1);
        await expect(canvas).toHaveAttribute('data-target-visible', 'false');

        const shelteredWetness = await wetness.textContent();
        const shelteredTick = Number(await connection.getAttribute('data-tick'));
        await expect
            .poll(async () => Number(await connection.getAttribute('data-tick')))
            .toBeGreaterThan(shelteredTick + 22);
        await expect(wetness).toHaveText(shelteredWetness);

        await host.stop('SIGTERM');
        host = startHost(path);
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(wetness).toHaveText(shelteredWetness);
        await expect(wetness).toBeVisible();
    } finally {
        await host.stop('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
    }
});

test('cold slows confirmed walking and daylight removes the penalty while the cold warning remains', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-cold-smoke-'));
    const path = join(directory, 'world.sqlite');
    const position = { xMeters: 0, yMeters: -10 };
    const store = new SoloWorldStore(path);
    store.savePosition(position, 0, {
        thirstMs: 0,
        hungerMs: 0,
        fatigueMs: 0,
        wetnessMs: 0,
        coldMs: coldSettings.walkPenaltyAtMs + 8 * 60_000,
    });
    store.close();
    const host = startHost(path);
    const cold = page.locator('#cold-status');
    const connection = page.getByRole('status');
    const canvas = page.locator('canvas');
    const readMotion = () =>
        connection.evaluate(element => ({
            tick: Number(element.dataset.tick),
            x: Number(element.dataset.xMeters),
        }));
    const walk = async (key, multiplier) => {
        await page.locator('#game').focus();
        const idle = await readMotion();
        await page.keyboard.down(key);
        try {
            await expect
                .poll(async () => Math.abs((await readMotion()).x - idle.x))
                .toBeGreaterThan(0);
            const start = await readMotion();
            await expect
                .poll(async () => (await readMotion()).tick)
                .toBeGreaterThanOrEqual(start.tick + 4);
            const end = await readMotion();
            const speed =
                (Math.abs(end.x - start.x) * movementSettings.ticksPerSecond) /
                (end.tick - start.tick);
            expect(speed).toBeCloseTo(movementSettings.walkSpeedMetersPerSecond * multiplier, 2);
            await expect
                .poll(async () => {
                    const renderedX =
                        (Number(await canvas.getAttribute('data-player-x')) - 480) / 24;
                    return Math.abs(renderedX - (await readMotion()).x);
                })
                .toBeLessThan(0.5);
        } finally {
            await page.keyboard.up(key);
        }
    };

    try {
        await expect.poll(host.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(canvas).toHaveAttribute('data-player-visible', 'true');
        await expect(cold).toContainText('Ходьба медленнее');
        await walk('a', coldSettings.walkSpeedMultiplier);
        await expect(cold).toHaveText(/^Холод: \d+%$/, { timeout: 15000 });
        await walk('d', 1);
    } finally {
        await host.stop('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
    }
});
