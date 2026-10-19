import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const position = page =>
    page.getByRole('status').evaluate(element => ({
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
    }));
const view = page =>
    page.locator('canvas').evaluate(canvas => ({
        playerX: Number(canvas.dataset.playerX),
        playerY: Number(canvas.dataset.playerY),
        cameraX: Number(canvas.dataset.cameraX),
        cameraY: Number(canvas.dataset.cameraY),
        targetX: Number(canvas.dataset.targetX),
        targetY: Number(canvas.dataset.targetY),
        aimX: Number(canvas.dataset.aimX),
        aimY: Number(canvas.dataset.aimY),
        angle: Number(canvas.dataset.aimAngle),
    }));
const open = async page => {
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
    await page.locator('canvas').scrollIntoViewIfNeeded();
};
const pointer = async (page, x, y, isClick = false) => {
    const box = await page.locator('canvas').boundingBox();
    const screenX = box.x + box.width * x;
    const screenY = box.y + box.height * y;
    if (isClick) await page.mouse.click(screenX, screenY);
    else await page.mouse.move(screenX, screenY);
};
const stopped = async page => {
    const start = await position(page);
    await expect.poll(async () => (await position(page)).tick).toBeGreaterThan(start.tick + 5);
    const a = await position(page);
    await expect.poll(async () => (await position(page)).tick).toBeGreaterThan(a.tick + 5);
    expect(await position(page)).toMatchObject({ x: a.x, y: a.y });
    return a;
};

test('camera follows beyond the initial grid and mouse aim uses world coordinates after resize', async ({
    page,
}) => {
    await open(page);
    const start = await position(page);
    await page.getByRole('heading').click();
    await page.keyboard.down('w');
    await expect
        .poll(async () => (await position(page)).y, { timeout: 8000 })
        .toBeLessThan(start.y - 12);
    await page.keyboard.up('w');
    await stopped(page);
    await expect
        .poll(async () => {
            const v = await view(page);
            return Math.abs(v.playerY - v.cameraY - 270);
        })
        .toBeLessThan(0.01);
    await page.setViewportSize({ width: 800, height: 800 });
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await pointer(page, 0.75, 0.25);
    await expect(page.locator('canvas')).toHaveAttribute('data-aim-visible', 'true');
    await expect
        .poll(async () => Math.abs((await view(page)).angle - Math.atan2(-135, 240)))
        .toBeLessThan(0.01);
    const p = await position(page);
    const v = await view(page);
    expect(v.aimX).toBeCloseTo(p.x + 10, 1);
    expect(v.aimY).toBeCloseTo(p.y - 5.625, 1);
    await pointer(page, 0.3, 0.6, true);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
    const destination = await view(page);
    // Browser mouse coordinates round to CSS pixels after scaling/scrolling.
    // Check within one displayed pixel, including at a fractional canvas size.
    const box = await page.locator('canvas').boundingBox();
    const pointerToleranceMeters = 960 / box.width / 24;
    expect(Math.abs(destination.targetX - (p.x - 8))).toBeLessThan(pointerToleranceMeters);
    expect(Math.abs(destination.targetY - (p.y + 2.25))).toBeLessThan(pointerToleranceMeters);
    await expect.poll(async () => (await position(page)).x).toBeCloseTo(destination.targetX, 7);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
    const arrived = await stopped(page);
    expect(arrived.y).toBeCloseTo(destination.targetY, 7);
    await page.reload();
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    expect(await position(page)).toMatchObject({ x: arrived.x, y: arrived.y });
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
});

test('new clicks replace destinations; keyboard, blur and disconnect cancel mouse movement', async ({
    page,
    context,
}) => {
    await open(page);
    const start = await position(page);
    await pointer(page, 0.9, 0.5, true);
    await expect.poll(async () => (await position(page)).x).toBeGreaterThan(start.x + 0.4);
    await pointer(page, 0.35, 0.65, true);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
    await expect.poll(async () => (await view(page)).targetX).toBeLessThan(start.x);
    const target = await view(page);
    await expect.poll(async () => (await position(page)).x).toBeCloseTo(target.targetX, 7);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
    await stopped(page);
    await pointer(page, 0.85, 0.5, true);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
    await page.keyboard.down('w');
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
    await page.keyboard.up('w');
    await stopped(page);
    await pointer(page, 0.85, 0.5, true);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
    await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
    await stopped(page);
    await pointer(page, 0.85, 0.5, true);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
    await context.setOffline(true);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Подключиться снова' }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await stopped(page);
    const beforeUiClick = await position(page);
    await page.getByRole('heading').click();
    expect(await stopped(page)).toMatchObject({ x: beforeUiClick.x, y: beforeUiClick.y });
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await pointer(page, 0.72, 0.35, true);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
    await mkdir('.cache', { recursive: true });
    await page.screenshot({ path: '.cache/t006-camera-mouse.png', fullPage: true });
    await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
    await stopped(page);
});
