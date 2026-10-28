import { expect, test } from '@playwright/test';

const open = async page => {
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
};
const assertPointer = async page => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4);
    await expect(canvas).toHaveAttribute('data-aim-visible', 'true');
    await expect
        .poll(async () => Number(await canvas.getAttribute('data-aim-angle')))
        .toBeCloseTo(Math.atan2(-54, 144), 1);
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await expect(canvas).toHaveAttribute('data-target-visible', 'true');
    const coordinates = await canvas.evaluate(element => ({
        targetX: Number(element.dataset.targetX),
        playerX: Number(element.dataset.playerX),
        targetY: Number(element.dataset.targetY),
        playerY: Number(element.dataset.playerY),
    }));
    const tolerance = 960 / box.width / 24 + 0.25;
    expect(Math.abs(coordinates.targetX - ((coordinates.playerX - 480) / 24 + 2))).toBeLessThan(
        tolerance,
    );
    expect(Math.abs(coordinates.targetY - (coordinates.playerY - 270) / 24)).toBeLessThan(
        tolerance,
    );
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
