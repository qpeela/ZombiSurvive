import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const position = page =>
    page.getByRole('status').evaluate(element => ({
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
    }));
const clickWorld = async (page, x, y) => {
    const current = await position(page);
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.click(
        box.x + (box.width * (480 + (x - current.x) * 24)) / 960,
        box.y + (box.height * (270 + (y - current.y) * 24)) / 540,
    );
};
const arrive = async (page, x, y) => {
    await clickWorld(page, x, y);
    await expect.poll(async () => (await position(page)).x).toBeCloseTo(x, 1);
    await expect.poll(async () => (await position(page)).y).toBeCloseTo(y, 1);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
};
const assertBlocked = async page => {
    await expect.poll(async () => (await position(page)).x).toBe(4.65);
    const atWall = await position(page);
    await expect.poll(async () => (await position(page)).tick).toBeGreaterThan(atWall.tick + 10);
    expect((await position(page)).x).toBe(4.65);
    await expect(page.locator('canvas')).toHaveAttribute('data-player-x', String(480 + 4.65 * 24));
};

test('visible walls block WASD and clicks; sliding and manual waypoints lead around them', async ({
    page,
}) => {
    // Isolated world: existing camera/movement scenarios use their own server on 3101.
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3103' },
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
        await page.goto('http://127.0.0.1:3103/');
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
        const obstacles = await page
            .locator('canvas')
            .evaluate(canvas => JSON.parse(canvas.dataset.obstacles));
        expect(obstacles).toContainEqual({
            id: 'v1:0:0:east-wall',
            minXMeters: 5,
            minYMeters: -3,
            maxXMeters: 5.5,
            maxYMeters: 3,
        });
        await page.getByRole('heading').click();
        await page.keyboard.down('d');
        await assertBlocked(page);
        await page.keyboard.down('s');
        await expect.poll(async () => (await position(page)).y).toBeGreaterThan(0.6);
        await page.keyboard.up('s');
        await page.keyboard.up('d');
        expect((await position(page)).x).toBe(4.65);
        // Wait for the key-up command to reach the server before mapping a world click.
        const released = await position(page);
        await expect
            .poll(async () => (await position(page)).tick)
            .toBeGreaterThan(released.tick + 5);
        const stopped = await position(page);
        await expect
            .poll(async () => (await position(page)).tick)
            .toBeGreaterThan(stopped.tick + 5);
        expect(await position(page)).toMatchObject({ x: stopped.x, y: stopped.y });
        await page.locator('canvas').scrollIntoViewIfNeeded();
        await arrive(page, 4, 0);
        await clickWorld(page, 7, 0);
        await assertBlocked(page);
        await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
        await mkdir('.cache', { recursive: true });
        await page.screenshot({ path: '.cache/t007-collisions.png', fullPage: true });
        await page.reload();
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        expect((await position(page)).x).toBe(4.65);
        await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
        await page.locator('canvas').scrollIntoViewIfNeeded();
        await arrive(page, 4, 4);
        await arrive(page, 7, 4);
    } finally {
        if (host.exitCode === null) host.kill('SIGTERM');
        await exited;
    }
});
