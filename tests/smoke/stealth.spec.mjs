import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const state = page =>
    page.getByRole('status').evaluate(element => ({
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
        stamina: Number(element.dataset.stamina),
        isSneaking: element.dataset.sneaking === 'true',
        noise: Number(element.dataset.noiseRadius),
    }));

const measureSpeed = async (page, metersPerTick) => {
    const start = await state(page);
    await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(start.tick + 8);
    const end = await state(page);
    expect((start.y - end.y) / (end.tick - start.tick)).toBeCloseTo(metersPerTick, 8);
};

test('Ctrl stealth agrees with authority, overrides Shift, supports clicks, and resets on blur/reload', async ({
    page,
}) => {
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
        env: { ...process.env, PORT: '3107' },
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
        await page.goto('http://127.0.0.1:3107/');
        const status = page.getByRole('status');
        const canvas = page.locator('canvas');
        await expect(status).toHaveAttribute('data-status', 'connected');
        await expect(canvas).toHaveAttribute('data-player-visible', 'true');
        await page.getByRole('heading').click();
        await page.keyboard.down('ShiftLeft');
        await page.keyboard.down('w');
        await expect.poll(async () => (await state(page)).stamina).toBeLessThan(0.95);
        await expect.poll(async () => (await state(page)).noise).toBe(16);
        await page.keyboard.down('ControlLeft');
        await expect(status).toHaveAttribute('data-sneaking', 'true');
        await expect.poll(async () => (await state(page)).noise).toBe(2);
        const beforeSneak = await state(page);
        await measureSpeed(page, 0.1);
        expect((await state(page)).stamina).toBeGreaterThan(beforeSneak.stamina);
        await page.keyboard.up('w');
        await page.keyboard.up('ShiftLeft');
        await expect.poll(async () => (await state(page)).noise).toBe(0);
        const idle = await state(page);
        await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(idle.tick + 12);
        expect((await state(page)).isSneaking).toBe(true);
        // Ctrl is already held when WASD is pressed, so native shortcuts must be prevented.
        await page.keyboard.down('w');
        await expect.poll(async () => (await state(page)).noise).toBe(2);
        await measureSpeed(page, 0.1);
        await page.keyboard.up('w');
        await expect.poll(async () => (await state(page)).noise).toBe(0);
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + (box.height * (270 - 96)) / 540);
        await expect(canvas).toHaveAttribute('data-target-visible', 'true');
        await expect.poll(async () => (await state(page)).noise).toBe(2);
        // Changing Ctrl preserves the destination and switches back to walking.
        await page.keyboard.up('ControlLeft');
        await expect(status).toHaveAttribute('data-sneaking', 'false');
        await expect(canvas).toHaveAttribute('data-target-visible', 'true');
        await expect.poll(async () => (await state(page)).noise).toBe(8);
        await expect(canvas).toHaveAttribute('data-target-visible', 'false');
        await page.keyboard.down('ControlRight');
        await page.keyboard.down('w');
        await expect(status).toHaveAttribute('data-sneaking', 'true');
        await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
        await page.keyboard.up('w');
        await page.keyboard.up('ControlRight');
        await expect(status).toHaveAttribute('data-sneaking', 'false');
        await expect.poll(async () => (await state(page)).noise).toBe(0);
        const blurred = await state(page);
        await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(blurred.tick + 6);
        expect((await state(page)).y).toBe(blurred.y);
        await page.keyboard.down('ControlLeft');
        await expect(status).toHaveAttribute('data-sneaking', 'true');
        await expect(page.locator('#movement-label')).toContainText('Скрытность · Шум: 0 м');
        await mkdir('.cache', { recursive: true });
        await page.screenshot({ path: '.cache/t010-stealth.png', fullPage: true });
        await page.reload();
        await page.keyboard.up('ControlLeft');
        await expect(status).toHaveAttribute('data-status', 'connected');
        await expect(status).toHaveAttribute('data-sneaking', 'false');
        await expect.poll(async () => (await state(page)).noise).toBe(0);
    } finally {
        await page.close();
        if (host.exitCode === null) host.kill('SIGTERM');
        await exited;
    }
});
