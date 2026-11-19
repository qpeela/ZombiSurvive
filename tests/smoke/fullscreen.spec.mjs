import { expect } from '@playwright/test';

import { openInventory } from '../fixtures/game-panels.mjs';
import { isolatedHostOrigin, test } from '../fixtures/isolated-host.mjs';

test.use({ baseURL: isolatedHostOrigin });

const open = async page => {
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
    await expect(page.locator('#health')).toHaveAttribute('value', '100');
    await expect(page.locator('#death-screen')).toBeHidden();
};
const assertPointer = async page => {
    const canvas = page.locator('canvas');
    const status = page.getByRole('status');
    // Cancel prior intent and wait for its authoritative stop before measuring the origin.
    await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
    const stopTick = Number(await status.getAttribute('data-tick'));
    await expect
        .poll(async () => Number(await status.getAttribute('data-tick')))
        .toBeGreaterThan(stopTick + 2);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const field = globalThis.document.querySelector('canvas');
                const connection = globalThis.document.querySelector('#connection-status');
                return Math.hypot(
                    (Number(field.dataset.playerX) - 480) / 24 - Number(connection.dataset.xMeters),
                    (Number(field.dataset.playerY) - 270) / 24 - Number(connection.dataset.yMeters),
                );
            }),
        )
        .toBeLessThan(0.000001);
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4);
    await expect(canvas).toHaveAttribute('data-aim-visible', 'true');
    await expect
        .poll(async () => Number(await canvas.getAttribute('data-aim-angle')))
        .toBeCloseTo(Math.atan2(-54, 144), 1);
    // Capture the coordinate contract at the native event. Fullscreen/focus scrolling
    // may change the canvas rectangle between earlier observations and this click.
    await canvas.evaluate(element => {
        element.addEventListener(
            'mousedown',
            event => {
                const bounds = element.getBoundingClientRect();
                element.dataset.testClickX = String(
                    (((event.clientX - bounds.left) * element.width) / bounds.width +
                        Number(element.dataset.cameraX) -
                        480) /
                        24,
                );
                element.dataset.testClickY = String(
                    (((event.clientY - bounds.top) * element.height) / bounds.height +
                        Number(element.dataset.cameraY) -
                        270) /
                        24,
                );
            },
            { once: true, capture: true },
        );
    });
    const clickTick = Number(await status.getAttribute('data-tick'));
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await expect(canvas).toHaveAttribute('data-target-visible', 'true');
    // Deliberately allow server movement before inspecting the target. CI scheduling
    // must not make the expected coordinates depend on a later render or player position.
    await expect
        .poll(async () => Number(await status.getAttribute('data-tick')))
        .toBeGreaterThan(clickTick + 2);
    const coordinates = await canvas.evaluate(element => ({
        targetX: Number(element.dataset.targetX),
        targetY: Number(element.dataset.targetY),
        expectedX: Number(element.dataset.testClickX),
        expectedY: Number(element.dataset.testClickY),
    }));
    // Both sides use the delivered event, so CSS-pixel rounding is already accounted for.
    const tolerance = 0.01;
    expect(Math.abs(coordinates.targetX - coordinates.expectedX)).toBeLessThan(tolerance);
    expect(Math.abs(coordinates.targetY - coordinates.expectedY)).toBeLessThan(tolerance);
    await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
    await expect(canvas).toHaveAttribute('data-target-visible', 'false');
};

for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
]) {
    test(`windowed game fills ${viewport.width} × ${viewport.height} and scrolls only the controls`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await open(page);
        const canvas = page.locator('canvas');
        const expectedBounds = { x: 0, y: 0, ...viewport };
        await expect.poll(() => canvas.boundingBox()).toEqual(expectedBounds);
        await expect(page.locator('#fullscreen')).toBeInViewport();
        await expect(page.locator('#health')).toBeInViewport();
        await page.screenshot({ path: `.cache/t062-${viewport.width}.png` });

        const controls = page.getByRole('region', { name: 'Настройки и игровые действия' });
        await controls.focus();
        await page.keyboard.press('Space');
        await expect.poll(() => controls.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        const attack = page.locator('#melee-attack');
        await attack.scrollIntoViewIfNeeded();
        await expect(attack).toBeInViewport();
        await expect(page.locator('#fullscreen')).toBeInViewport();
        expect(await canvas.boundingBox()).toEqual(expectedBounds);
        expect(
            await page.evaluate(() => ({
                width: globalThis.document.documentElement.scrollWidth,
                height: globalThis.document.documentElement.scrollHeight,
            })),
        ).toEqual(viewport);
        await expect(controls).toBeFocused();
        await assertPointer(page);
        await expect(controls).not.toBeFocused();
    });
}

test('resizing the viewport updates the aim under a stationary mouse', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    const canvas = page.locator('canvas');
    await expect.poll(() => canvas.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    const cursor = { x: 770, y: 140 };
    await page.mouse.move(cursor.x, cursor.y);
    await expect(canvas).toHaveAttribute('data-aim-visible', 'true');
    const initialAngle = Number(await canvas.getAttribute('data-aim-angle'));

    await page.setViewportSize({ width: 1280, height: 580 });
    await expect.poll(async () => (await canvas.boundingBox()).height).toBe(580);
    const bounds = await canvas.boundingBox();
    const expectedAngle = Math.atan2(
        ((cursor.y - bounds.y) * 540) / bounds.height - 270,
        ((cursor.x - bounds.x) * 960) / bounds.width - 480,
    );
    expect(Math.abs(initialAngle - expectedAngle)).toBeGreaterThan(0.1);
    await expect
        .poll(async () => Number(await canvas.getAttribute('data-aim-angle')))
        .toBeCloseTo(expectedAngle, 2);
});

test('fullscreen includes HTML UI, preserves pointer coordinates and exits with button or browser', async ({
    page,
}) => {
    await open(page);
    const enter = page.locator('#fullscreen');
    await enter.click();
    await expect
        .poll(() => page.evaluate(() => globalThis.document.fullscreenElement?.className))
        .toBe('game-shell');
    await expect(page.locator('#health')).toBeInViewport();
    await openInventory(page);
    await page.locator('#inventory-grid').scrollIntoViewIfNeeded();
    await expect(page.locator('#inventory-grid')).toBeInViewport();
    await page.locator('#toggle-inventory').click();
    await expect(page.locator('#inventory-panel')).toBeHidden();
    await page.locator('#melee-attack').scrollIntoViewIfNeeded();
    await expect(page.locator('#melee-attack')).toBeInViewport();
    await assertPointer(page);
    await page.screenshot({ path: '.cache/t021-fullscreen.png' });
    await page.getByRole('button', { name: 'Выйти из полного экрана' }).click();
    await expect
        .poll(() => page.evaluate(() => globalThis.document.fullscreenElement === null))
        .toBe(true);
    // Chromium requires restoring its native window before setViewportSize.
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await assertPointer(page);
    await enter.click();
    await expect(enter).toHaveAttribute('aria-pressed', 'true');
    await assertPointer(page);
    await page.keyboard.press('Escape');
    await expect(enter).toHaveAttribute('aria-pressed', 'false');
    await enter.click();
    await expect(enter).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => globalThis.document.exitFullscreen());
    await expect(enter).toHaveAttribute('aria-pressed', 'false');
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await assertPointer(page);
});

test('fullscreen denial and unsupported browsers leave the game usable', async ({ page }) => {
    await page.addInitScript(() => {
        globalThis.HTMLElement.prototype.requestFullscreen = () =>
            Promise.reject(new Error('Denied'));
    });
    await open(page);
    const button = page.getByRole('button', { name: 'На весь экран', exact: true });
    await button.click();
    await expect(page.locator('#fullscreen-message')).toContainText('Не удалось');
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('textbox', { name: 'Имя игрока' }).fill('');
    await page.getByRole('button', { name: 'Сохранить имя', exact: true }).click();
    await expect(page.locator('#profile-message')).toContainText('1–24');
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await assertPointer(page);
    await page.addInitScript(() => {
        Object.defineProperty(globalThis.document, 'fullscreenEnabled', { value: false });
    });
    await page.reload();
    await expect(button).toBeDisabled();
    await expect(page.locator('#fullscreen-message')).toContainText('недоступен');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
});
