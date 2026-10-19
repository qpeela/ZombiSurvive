import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const state = page =>
    page.getByRole('status').evaluate(element => ({
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
        stamina: Number(element.dataset.stamina),
        isExhausted: element.dataset.exhausted === 'true',
    }));

const measureSpeed = async (page, metersPerTick) => {
    const start = await state(page);
    await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(start.tick + 8);
    const end = await state(page);
    expect((start.y - end.y) / (end.tick - start.tick)).toBeCloseTo(metersPerTick, 8);
};

test('Shift sprints, exhausts, recovers, and supports clicks and reload in the hosted game', async ({
    page,
}) => {
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
        env: { ...process.env, PORT: '3106' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    host.stdout.on('data', chunk => {
        output += chunk.toString();
    });
    host.stderr.on('data', chunk => {
        output += chunk.toString();
    });
    const exited = new Promise(resolve => host.once('exit', resolve));
    try {
        await expect.poll(() => output).toContain('Local world ready');
        await page.goto('http://127.0.0.1:3106/');
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
        await page.getByRole('heading').click();
        await page.keyboard.down('Shift');
        await page.keyboard.down('w');
        await expect.poll(async () => (await state(page)).stamina).toBeLessThan(0.99);
        await measureSpeed(page, 0.35);
        await expect
            .poll(async () => (await state(page)).isExhausted, { timeout: 10000 })
            .toBe(true);
        await expect(page.locator('#stamina-label')).toContainText('Восстановление до 20%');
        await measureSpeed(page, 0.2);
        await page.keyboard.up('w');
        await page.keyboard.up('Shift');
        const exhausted = await state(page);
        await expect
            .poll(async () => (await state(page)).stamina)
            .toBeGreaterThan(exhausted.stamina + 0.03);
        const beforeReload = await state(page);
        await page.reload();
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        const reloaded = await state(page);
        expect(reloaded.stamina).toBeLessThan(0.8);
        expect(reloaded.stamina).toBeGreaterThanOrEqual(beforeReload.stamina);
        await expect.poll(async () => (await state(page)).isExhausted).toBe(false);
        await page.locator('canvas').scrollIntoViewIfNeeded();
        await page.keyboard.down('Shift');
        const box = await page.locator('canvas').boundingBox();
        // A point three meters north of the player, independent of camera scroll.
        const beforeClick = await state(page);
        await page.mouse.click(box.x + box.width / 2, box.y + (box.height * (270 - 72)) / 540);
        await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
        await expect
            .poll(async () => (await state(page)).stamina)
            .toBeLessThan(beforeClick.stamina);
        await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
        await page.keyboard.up('Shift');
        await expect.poll(async () => (await state(page)).stamina).toBeGreaterThan(0.1);
        // Blur cancels both modifiers and WASD; a new direction alone walks.
        await page.keyboard.down('Shift');
        await page.keyboard.down('w');
        await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
        await page.keyboard.up('w');
        await page.keyboard.up('Shift');
        const blurred = await state(page);
        await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(blurred.tick + 5);
        const stopped = await state(page);
        await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(stopped.tick + 5);
        expect((await state(page)).y).toBe(stopped.y);
        await page.keyboard.down('w');
        await expect.poll(async () => (await state(page)).y).toBeLessThan(stopped.y);
        await measureSpeed(page, 0.2);
        await page.keyboard.up('w');
        await mkdir('.cache', { recursive: true });
        await page.screenshot({ path: '.cache/t009-sprint.png', fullPage: true });
    } finally {
        await page.close();
        if (host.exitCode === null) host.kill('SIGTERM');
        await exited;
    }
});
