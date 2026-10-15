import { expect, test } from '@playwright/test';

const hostOrigin = 'http://127.0.0.1:3101';
const readPlayer = page =>
    page.getByRole('status').evaluate(element => ({
        x: Number(element.dataset.xMeters),
        playerId: element.dataset.playerId,
        worldId: element.dataset.worldId,
    }));

test('npm start serves the game and moves a character through the same origin without Vite', async ({
    page,
}) => {
    const errors = [];
    const sockets = [];
    const resources = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => resources.push(response.url()));
    page.on('websocket', socket => sockets.push(socket.url()));
    await page.goto(`${hostOrigin}/`);
    await expect(page).toHaveTitle('ZombiSurvive');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
    expect(sockets).toHaveLength(1);
    expect(new URL(sockets[0]).origin).toBe('ws://127.0.0.1:3101');
    expect(resources.every(url => new URL(url).origin === hostOrigin)).toBe(true);
    expect(resources.some(url => new URL(url).pathname.endsWith('.js'))).toBe(true);
    expect(resources.some(url => new URL(url).pathname.endsWith('.css'))).toBe(true);

    const start = await readPlayer(page);
    await page.getByRole('heading').click();
    await page.keyboard.down('d');
    await expect.poll(async () => (await readPlayer(page)).x).toBeGreaterThan(start.x + 0.2);
    await page.keyboard.up('d');
    await page.reload();
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    expect(await readPlayer(page)).toMatchObject({
        playerId: start.playerId,
        worldId: start.worldId,
    });
    expect(errors).toEqual([]);
});

test('host serves GET/HEAD assets and rejects unknown paths, mutations and untrusted hosts', async ({
    request,
}) => {
    const index = await request.get(`${hostOrigin}/`);
    await expect(index).toBeOK();
    expect(index.headers()['content-type']).toBe('text/html; charset=utf-8');
    expect(index.headers()['cache-control']).toBe('no-store');
    const html = await index.text();
    const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(
        match => match[1],
    );
    expect(assetPaths).toHaveLength(2);

    for (const path of ['/', '/index.html', ...assetPaths]) {
        const head = await request.head(`${hostOrigin}${path}`);
        await expect(head).toBeOK();
        expect(await head.body()).toHaveLength(0);
        expect(Number(head.headers()['content-length'])).toBeGreaterThan(0);
        const mutation = await request.post(`${hostOrigin}${path}`);
        expect(mutation.status()).toBe(405);
        expect(mutation.headers()['allow']).toBe('GET, HEAD');
        const trace = await request.fetch(`${hostOrigin}${path}`, { method: 'TRACE' });
        expect(trace.status()).toBe(405);
    }

    for (const path of [
        '/assets/missing.js',
        '/src/main.ts',
        '/package.json',
        '/.env',
        '/assets/..%2f..%2fpackage.json',
        '/unknown-page',
    ]) {
        const response = await request.get(`${hostOrigin}${path}`);
        expect(response.status()).toBe(404);
    }

    for (const headers of [
        { Host: 'untrusted.example' },
        { Origin: 'https://untrusted.example' },
    ]) {
        const response = await request.get(`${hostOrigin}/`, { headers });
        expect(response.status()).toBe(403);
    }
});
