import { expect, test } from '@playwright/test';

test('production client boots a Phaser scene without browser errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            errors.push(message.text());
        }
    });

    await page.goto('/');
    await expect(page).toHaveTitle('ZombiSurvive');
    await expect(page.getByRole('heading', { name: 'ZombiSurvive' })).toBeVisible();
    const canvas = page.locator('#game canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('data-scene-ready', 'true');
    expect(await canvas.evaluate(element => element.width > 0 && element.height > 0)).toBe(true);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.getByRole('status')).toContainText('Стартовая позиция: 0, 0 м.');
    expect(errors).toEqual([]);
});

test('compiled server exposes health and handles HEAD', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3101/health');
    await expect(response).toBeOK();
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers()['cache-control']).toBe('no-store');

    const head = await request.head('http://127.0.0.1:3101/health');
    await expect(head).toBeOK();
    expect(await head.text()).toBe('');
});

test('health rejects mutations and unknown routes return 404', async ({ request }) => {
    const mutation = await request.post('http://127.0.0.1:3101/health');
    expect(mutation.status()).toBe(405);
    expect(mutation.headers()['allow']).toBe('GET, HEAD');

    const missing = await request.get('http://127.0.0.1:3101/missing');
    expect(missing.status()).toBe(404);
});
