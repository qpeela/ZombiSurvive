import { expect } from '@playwright/test';

/** Use rendered camera coordinates and actual pointer input, never a game-state shortcut. */
export const clickWorld = async ({ page, position, button = 'left' }) => {
    const canvas = page.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas).toHaveAttribute('data-camera-x', /-?\d/);
    const camera = await canvas.evaluate(element => ({
        x: Number(element.dataset.cameraX),
        y: Number(element.dataset.cameraY),
    }));
    const box = await canvas.boundingBox();

    if (box === null) throw new Error('Game canvas is not visible.');

    const x = ((480 + position.xMeters * 24 - camera.x) * box.width) / 960;
    const y = ((270 + position.yMeters * 24 - camera.y) * box.height) / 540;
    const isInside = x >= 0 && y >= 0 && x < box.width && y < box.height;

    if (!isInside) throw new Error('World target needs a visible waypoint.');

    await page.mouse.click(box.x + x, box.y + y, { button });
};
export const movePlayerTo = async ({ page, position, timeoutMs = 15000 }) => {
    await clickWorld({ page, position });
    const status = page.getByRole('status');
    const box = await page.locator('canvas').boundingBox();
    if (box === null) throw new Error('Game canvas is not visible.');
    // Pointer coordinates quantize to a CSS pixel. Scale both axes back to meters
    // instead of demanding sub-pixel precision from a reduced canvas on CI.
    const toleranceMeters = Math.max(0.05, Math.hypot(960 / box.width, 540 / box.height) / 24);
    await expect
        .poll(
            async () => {
                const x = await status.getAttribute('data-x-meters');
                const y = await status.getAttribute('data-y-meters');
                return x === null || y === null
                    ? Infinity
                    : Math.hypot(Number(x) - position.xMeters, Number(y) - position.yMeters);
            },
            { timeout: timeoutMs },
        )
        .toBeLessThanOrEqual(toleranceMeters);
};
export const activateStartingZombie = async page => {
    await movePlayerTo({ page, position: { xMeters: -3, yMeters: 0 } });
    const playerId = await page.getByRole('status').getAttribute('data-player-id');
    await expect
        .poll(() =>
            page
                .locator('canvas')
                .evaluate(
                    canvas =>
                        JSON.parse(canvas.dataset.zombies ?? '[]').find(
                            zombie => zombie.zombieId === 'slow-zombie-1',
                        )?.targetPlayerId,
                ),
        )
        .toBe(playerId);
    await movePlayerTo({ page, position: { xMeters: 0, yMeters: 0 } });
};

export const distanceToStartingZombie = page =>
    page.locator('canvas').evaluate(canvas => {
        const zombie = JSON.parse(canvas.dataset.zombies ?? '[]').find(
            zombie => zombie.zombieId === 'slow-zombie-1',
        );
        const status = canvas.ownerDocument.querySelector('#connection-status');
        const x = status?.getAttribute('data-x-meters');
        const y = status?.getAttribute('data-y-meters');
        if (zombie === undefined || x === undefined || x === null || y === undefined || y === null)
            return Infinity;
        return Math.hypot(zombie.position.xMeters - Number(x), zombie.position.yMeters - Number(y));
    });
