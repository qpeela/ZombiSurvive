import { expect } from '@playwright/test';

import { isolatedHostOrigin, test } from '../fixtures/isolated-host.mjs';

test.use({ baseURL: isolatedHostOrigin });

test('the map reveals entered chunks, remembers unloaded terrain and keeps input in the panel', async ({
    page,
}) => {
    test.setTimeout(100_000);
    await page.goto('/');
    const status = page.locator('#connection-status');
    const field = page.getByRole('region', { name: 'Игровое поле' });
    const gameCanvas = field.locator('canvas');
    const map = page.getByRole('region', { name: 'Карта посещений' });
    const viewport = map.getByRole('group', { name: 'Рельеф посещённых участков' });
    const mapCanvas = viewport.locator('canvas');
    const position = async axis => Number(await status.getAttribute(`data-${axis}-meters`));
    const moveAlong = async ({ key, axis, beyond }) => {
        await page.keyboard.down(key);
        try {
            await expect.poll(() => position(axis), { timeout: 35_000 }).toBeGreaterThan(beyond);
        } finally {
            await page.keyboard.up(key);
        }
        await expect(status).toHaveAttribute('data-noise-radius', '0');
    };

    await expect(status).toHaveAttribute('data-status', 'connected');
    await expect(gameCanvas).toHaveAttribute('data-world-chunks', /"chunkX":1/);
    await field.focus();
    await page.keyboard.press('m');
    await expect(map).toBeFocused();
    await expect(mapCanvas).toHaveAttribute('data-visible-chunks', '0,0');
    await expect(map.getByText(/Игрок · 0\.0, 0\.0/)).toBeVisible();
    await map.getByRole('button', { name: 'Уменьшить карту' }).click();
    await expect(mapCanvas).toHaveAttribute('data-pixels-per-meter', '1');
    await viewport.focus();
    await viewport.press('ArrowRight');
    await viewport.click({ button: 'right' });
    await viewport.press('d');
    await viewport.press('f');
    await viewport.press('r');
    await viewport.press('Space');
    await expect(gameCanvas).toHaveAttribute('data-target-visible', 'false');
    const stoppedAt = Number(await status.getAttribute('data-tick'));
    await expect
        .poll(async () => Number(await status.getAttribute('data-tick')))
        .toBeGreaterThan(stoppedAt + 4);
    expect(await position('x')).toBe(0);
    await viewport.press('Escape');
    await expect(field).toBeFocused();

    // The clear y=-10 corridor crosses two chunk seams without touching the ruins.
    await page.keyboard.down('w');
    try {
        await expect.poll(() => position('y')).toBeLessThan(-9.8);
    } finally {
        await page.keyboard.up('w');
    }
    await expect(status).toHaveAttribute('data-noise-radius', '0');
    await moveAlong({ key: 'd', axis: 'x', beyond: 98 });
    await expect(gameCanvas).toHaveAttribute('data-world-chunks', /"chunkX":3/);
    expect(await gameCanvas.getAttribute('data-world-chunks')).not.toContain('"chunkX":0');
    await page.keyboard.press('m');
    await expect(mapCanvas).toHaveAttribute('data-visible-chunks', '0,0 1,0 2,0');
    await page.keyboard.press('Escape');
    await page.keyboard.down('a');
    try {
        await expect.poll(() => position('x'), { timeout: 35_000 }).toBeLessThan(31);
    } finally {
        await page.keyboard.up('a');
    }
    await page.keyboard.press('m');
    await expect(mapCanvas).toHaveAttribute('data-visible-chunks', '0,0 1,0 2,0');
    await page.reload();
    await expect(status).toHaveAttribute('data-status', 'connected');
    await page.getByRole('button', { name: 'Карта (M)', exact: true }).click();
    await map.getByRole('button', { name: 'Уменьшить карту' }).click();
    await expect(mapCanvas).toHaveAttribute('data-visible-chunks', '0,0 1,0 2,0');
});

const openMap = async page => {
    await expect(page.locator('#connection-status')).toHaveAttribute('data-status', 'connected');
    await page.getByRole('button', { name: 'Карта (M)', exact: true }).click();

    return page.getByRole('region', { name: 'Карта посещений' });
};

test('map markers survive reload and support rename and removal', async ({ page }) => {
    await page.goto('/');
    const map = await openMap(page);
    const markers = map.getByLabel('Личные метки');
    const name = map.getByLabel('Название метки');
    const viewport = map.getByRole('group', { name: 'Рельеф посещённых участков' });
    const add = map.getByRole('button', { name: 'Поставить метку' });
    await viewport.press('ArrowRight');
    await viewport.press('ArrowRight');
    await expect(add).toBeDisabled();
    await map.getByRole('button', { name: 'К игроку' }).click();
    await name.fill('Начало маршрута');
    await add.click();
    await expect(map.getByText('Метка поставлена.')).toBeVisible();

    await page.reload();
    await openMap(page);
    await markers.selectOption({ label: 'Начало маршрута' });
    await expect(name).toHaveValue('Начало маршрута');
    await name.fill('Точка сбора');
    await map.getByRole('button', { name: 'Переименовать' }).click();
    await page.reload();
    await openMap(page);
    await markers.selectOption({ label: 'Точка сбора' });
    await map.getByRole('button', { name: 'Удалить метку' }).click();
    await expect(markers).toBeFocused();
    await expect(map.getByText('Метка удалена.')).toBeVisible();
    await page.reload();
    await openMap(page);
    await expect(markers.locator('option')).toHaveText(['Новая метка']);
});

test('map markers work with browser storage blocked', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(globalThis, 'localStorage', {
            get: () => {
                throw new DOMException('Storage is disabled', 'SecurityError');
            },
        });
    });
    await page.goto('/');
    const map = await openMap(page);
    await map.getByLabel('Название метки').fill('Временная');
    await map.getByRole('button', { name: 'Поставить метку' }).click();
    await expect(map.getByLabel('Личные метки').locator('option')).toHaveText([
        'Новая метка',
        'Временная',
    ]);
    await page.reload();
    await openMap(page);
    await expect(map.getByLabel('Личные метки').locator('option')).toHaveText(['Новая метка']);
});
