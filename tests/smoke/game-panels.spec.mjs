import { expect } from '@playwright/test';

import { isolatedHostOrigin, test } from '../fixtures/isolated-host.mjs';

test.use({ baseURL: isolatedHostOrigin });

test('opening panels releases held movement; Tab, clicks and attack keys stay in the UI', async ({
    page,
}) => {
    await page.goto('/');
    const status = page.getByRole('status');
    const field = page.getByRole('region', { name: 'Игровое поле' });
    const inventory = page.getByRole('region', { name: 'Инвентарь' });
    const equipment = page.getByRole('region', { name: 'Экипировка' });
    const equipmentToggle = page.getByRole('button', { name: 'Экипировка (Q)', exact: true });
    const canvas = page.locator('canvas');
    const position = async () => Number(await status.getAttribute('data-x-meters'));
    const tick = async () => Number(await status.getAttribute('data-tick'));
    const waitTicks = async count => {
        const start = await tick();
        await expect.poll(tick).toBeGreaterThanOrEqual(start + count);
    };

    await expect(status).toHaveAttribute('data-status', 'connected');
    await expect(canvas).toHaveAttribute('data-player-visible', 'true');
    await expect(inventory).toBeHidden();
    await expect(equipment).toBeHidden();
    await equipmentToggle.focus();
    await page.keyboard.press('Space');
    await expect(equipment).toBeFocused();
    const club = equipment.getByRole('button', { name: 'Экипировать дубинку', exact: true });
    await club.click();
    await expect(canvas).toHaveAttribute('data-weapon', 'club');
    await expect(equipment).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(equipmentToggle).toBeFocused();
    await expect(canvas).toHaveAttribute('data-weapon-attack-tick', '-1');
    await page.keyboard.press('f');
    await waitTicks(3);
    await expect(canvas).toHaveAttribute('data-weapon-attack-tick', '-1');

    await field.focus();
    const start = await position();
    await page.keyboard.down('d');
    try {
        await expect.poll(position).toBeGreaterThan(start + 0.2);
        await page.keyboard.press('i');
        await expect(inventory).toBeFocused();
        await waitTicks(3);
        const stopped = await position();

        await page.keyboard.press('Tab');
        const selector = inventory.locator('#inventory-items button:enabled').first();
        await expect(selector).toBeFocused();
        await page.keyboard.press('Space');
        await expect(selector).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('f');
        await inventory.getByRole('heading', { name: 'Инвентарь', exact: true }).click();
        await expect(canvas).toHaveAttribute('data-target-visible', 'false');
        await waitTicks(4);
        expect(await position()).toBe(stopped);
        await expect(canvas).toHaveAttribute('data-weapon-attack-tick', '-1');

        await selector.focus();
        await page.keyboard.press('q');
        await expect(equipment).toBeFocused();
        await expect(inventory).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(equipment).toBeHidden();
        await expect(selector).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(inventory).toBeHidden();
        await expect(field).toBeFocused();
        await waitTicks(4);
        expect(await position()).toBe(stopped);
    } finally {
        await page.keyboard.up('d');
    }

    const stopped = await position();
    await page.keyboard.down('d');
    try {
        await expect.poll(position).toBeGreaterThan(stopped + 0.2);
    } finally {
        await page.keyboard.up('d');
    }
    await page.keyboard.press('f');
    await expect(canvas).toHaveAttribute('data-weapon-attack-tick', /^\d+$/);
});
