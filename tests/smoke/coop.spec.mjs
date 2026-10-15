import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, readFile } from 'node:fs/promises';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

const origin = 'http://127.0.0.1:3105';
let host;
let exited;
let invitationsPath;
let invitations;
const readPlayer = page =>
    page.getByRole('status').evaluate(element => ({
        playerId: element.dataset.playerId,
        worldId: element.dataset.worldId,
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
    }));
const join = async (browser, index) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(invitations[index].url);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');

    return { context, page };
};

test.beforeAll(async () => {
    host = spawn(process.execPath, ['tests/fixtures/coop-host.mjs'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = once(host, 'exit');
    let output = '';
    host.stdout.on('data', chunk => {
        output += chunk;
    });
    host.stderr.on('data', chunk => {
        output += chunk;
    });
    await expect.poll(() => output).toContain('Invitations file:');
    invitationsPath = output.match(/Invitations file: ([^\n]+)/)[1];
    invitations = JSON.parse(await readFile(invitationsPath, 'utf8')).invitations;
});
test.afterAll(async () => {
    if (host?.exitCode === null) {
        host.kill('SIGTERM');
    }

    await exited;
});

test('invitations are required, one-time and origin-bound; HTTP credentials cannot bypass WebSocket auth', async ({
    request,
    playwright,
}) => {
    const endpoint = `${origin}/matchmake/joinById/${localWorldRoomId}`;
    expect((await request.post(endpoint, { headers: { Origin: origin }, data: {} })).status()).toBe(
        403,
    );
    for (const headers of [
        {},
        { Origin: 'https://untrusted.example' },
        { Origin: origin, Host: 'evil.example' },
    ]) {
        expect(
            (
                await request.post(`${origin}/session`, {
                    headers,
                    data: { invitation: invitations[0].url.split('=')[1] },
                })
            ).status(),
        ).toBe(403);
    }

    expect(
        (
            await request.post(`${origin}/session`, {
                headers: { Origin: origin },
                data: { invitation: 'invalid' },
            })
        ).status(),
    ).toBe(403);
    const token = new URL(invitations[0].url).hash.slice('#invite='.length);
    const response = await request.post(`${origin}/session`, {
        headers: { Origin: origin },
        data: { invitation: token },
    });
    expect(response.status()).toBe(204);
    const cookies = (await request.storageState()).cookies;
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    const cookie = `${cookies[0].name}=${cookies[0].value}`;
    const isolated = await playwright.request.newContext();

    try {
        expect(
            (
                await isolated.post(`${origin}/session`, {
                    headers: { Origin: origin },
                    data: { invitation: token },
                })
            ).status(),
        ).toBe(403);
        const client = new Client(origin, {
            headers: { Origin: origin },
            fetchFn: (url, options) =>
                fetch(url, {
                    ...options,
                    headers: { ...options.headers, Cookie: cookie, Origin: origin },
                }),
        });
        await expect(client.joinById(localWorldRoomId)).rejects.toThrow();
    } finally {
        await isolated.dispose();
    }
});

test('two browsers have distinct characters, see each other and retain identity on reload', async ({
    browser,
}) => {
    const first = await join(browser, 1);
    const second = await join(browser, 2);

    try {
        const a = await readPlayer(first.page);
        const b = await readPlayer(second.page);
        expect(a.worldId).toBe(b.worldId);
        expect(a.playerId).not.toBe(b.playerId);
        const cookies = await first.context.cookies();
        const client = new Client(origin, {
            headers: { Origin: origin, Cookie: `${cookies[0].name}=${cookies[0].value}` },
        });
        const forged = await client.joinById(localWorldRoomId, { playerId: b.playerId });

        try {
            expect((await forged.request(initialStateRequest)).player.playerId).toBe(a.playerId);
        } finally {
            await forged.leave();
        }

        expect(new URL(first.page.url()).hash).toBe('');
        expect(await first.page.evaluate(() => globalThis.document.cookie)).not.toContain(
            'zombi-session',
        );
        await expect(first.page.getByRole('status')).toHaveAttribute('data-player-count', '2');
        await expect(second.page.getByRole('status')).toHaveAttribute('data-player-count', '2');
        await first.page.bringToFront();
        await first.page.getByRole('heading').click();
        await first.page.keyboard.down('d');
        await expect.poll(async () => (await readPlayer(first.page)).x).toBeGreaterThan(a.x + 0.2);
        await first.page.keyboard.up('d');
        await expect
            .poll(
                async () =>
                    JSON.parse(
                        await second.page.locator('canvas').getAttribute('data-other-players'),
                    )[0].position.xMeters,
            )
            .toBeGreaterThan(a.x + 0.2);
        expect((await readPlayer(second.page)).x).toBe(b.x);
        expect((await readPlayer(second.page)).y).toBe(b.y);
        await second.page.bringToFront();
        await second.page.getByRole('heading').click();
        await second.page.keyboard.down('s');
        await expect.poll(async () => (await readPlayer(second.page)).y).toBeGreaterThan(b.y + 0.2);
        await second.page.keyboard.up('s');
        await first.page.reload();
        await expect(first.page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        expect(await readPlayer(first.page)).toMatchObject({
            worldId: a.worldId,
            playerId: a.playerId,
        });
        expect((await readPlayer(first.page)).x).toBeGreaterThan(a.x + 0.2);
    } finally {
        await first.context.close();
        await second.context.close();
    }
});

test('a returning browser keeps its character and stopping the host disconnects both participants', async ({
    browser,
}) => {
    const first = await join(browser, 3);
    const second = await join(browser, 4);

    try {
        const identity = await readPlayer(first.page);
        await first.context.setOffline(true);
        await expect(first.page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await first.context.setOffline(false);
        await first.page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(first.page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        expect(await readPlayer(first.page)).toMatchObject({
            playerId: identity.playerId,
            worldId: identity.worldId,
        });
        host.kill('SIGTERM');
        await expect(first.page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect(second.page.getByRole('status')).toHaveAttribute(
            'data-status',
            'disconnected',
        );
        expect(await exited).toEqual([0, null]);
        await expect(access(invitationsPath)).rejects.toThrow();
    } finally {
        await first.context.close();
        await second.context.close();
    }
});
