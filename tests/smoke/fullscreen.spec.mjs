import { expect, test } from '@playwright/test';

const open = async page => {
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
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
    await expect(page.locator('#inventory-grid')).toBeInViewport();
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
    // A real HTML validation message can reflow the UI above the canvas without
    // resizing the browser window. Pointer mapping must follow that new position.
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
