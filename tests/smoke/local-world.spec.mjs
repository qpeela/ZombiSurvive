import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

const serverOrigin = 'http://127.0.0.1:3101';
const clientOrigin = 'http://127.0.0.1:4173';

const readIdentity = async page => {
    const status = page.getByRole('status');
    await expect(status).toHaveAttribute('data-status', 'connected');

    return status.evaluate(element => ({
        worldId: element.dataset.worldId,
        playerId: element.dataset.playerId,
    }));
};

test('reloads, empty rooms and concurrent tabs retain the same solo world and character', async ({
    page,
    context,
}) => {
    await page.goto('/');
    const identity = await readIdentity(page);
    expect(identity.worldId).toBeTruthy();
    expect(identity.playerId).toBeTruthy();

    await page.reload();
    expect(await readIdentity(page)).toEqual(identity);
    await page.close();

    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([first.goto('/'), second.goto('/')]);
    expect(await readIdentity(first)).toEqual(identity);
    expect(await readIdentity(second)).toEqual(identity);
});

test('connection uses the page origin, reports network loss and can rejoin', async ({
    page,
    context,
}) => {
    const urls = [];
    page.on('websocket', socket => urls.push(socket.url()));
    await page.goto('/');
    const identity = await readIdentity(page);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).origin).toBe('ws://127.0.0.1:4173');

    await context.setOffline(true);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
    await expect(page.getByRole('status')).toContainText('Связь с хостом потеряна');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Подключиться снова' }).click();
    expect(await readIdentity(page)).toEqual(identity);
});

test('a rejected join presents an error and retry recovers', async ({ page }) => {
    await page.route('**/matchmake/joinById/**', route =>
        route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Host unavailable' }),
        }),
    );
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'error');
    await expect(page.getByRole('button', { name: 'Подключиться снова' })).toBeEnabled();

    await page.unroute('**/matchmake/joinById/**');
    await page.getByRole('button', { name: 'Подключиться снова' }).click();
    await readIdentity(page);
});

test('an unanswered WebSocket handshake times out and releases the socket', async ({ page }) => {
    await page.clock.install();
    let isClosed = false;
    let isSocketOpen = false;
    await page.routeWebSocket(/.*/, socket => {
        isSocketOpen = true;
        socket.onClose(() => {
            isClosed = true;
        });
        // Accept the socket without responding to the Colyseus handshake.
    });
    await page.addInitScript(() => {
        const Socket = globalThis.WebSocket;
        globalThis.WebSocket = class extends Socket {
            constructor(url, protocols) {
                // Preserve native browser validation. Colyseus first probes Node's
                // options overload, which Playwright's WebSocket mock accepts incorrectly.
                const isOptionsObject = typeof protocols === 'object' && protocols !== null;
                const isProtocolsArray = Array.isArray(protocols);

                if (isOptionsObject && !isProtocolsArray) {
                    throw new TypeError('Browser WebSocket does not support Node options.');
                }

                super(url, protocols);
            }
        };
    });
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connecting');
    await page.clock.runFor(100);
    await expect.poll(() => isSocketOpen).toBe(true);
    await page.clock.fastForward(10000);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'error');
    await expect(page.getByRole('status')).not.toHaveAttribute('data-world-id');
    await expect.poll(() => isClosed).toBe(true);
});

test('joining never creates another world and untrusted origins or hosts are rejected', async ({
    request,
}) => {
    const endpoint = `${serverOrigin}/matchmake/joinById/${localWorldRoomId}`;
    for (const origin of ['https://untrusted.example', 'null']) {
        const response = await request.post(endpoint, { headers: { Origin: origin }, data: {} });
        expect(response.status()).toBe(403);
    }

    const missingOrigin = await request.post(endpoint, { data: {} });
    expect(missingOrigin.status()).toBe(403);
    const rebinding = await request.post(endpoint, {
        headers: { Origin: clientOrigin, Host: 'untrusted.example' },
        data: {},
    });
    expect(rebinding.status()).toBe(403);

    for (const method of ['create', 'joinOrCreate']) {
        const response = await request.post(
            `${serverOrigin}/matchmake/${method}/${localWorldRoomId}`,
            {
                headers: { Origin: clientOrigin },
                data: {},
            },
        );
        expect((await response.json()).error).toContain('invalid method');
    }
});

test('real transport rejects an untrusted WebSocket Origin after valid matchmaking', async () => {
    const client = new Client(serverOrigin, {
        headers: { Origin: 'https://untrusted.example' },
        fetchFn: (url, options) =>
            fetch(url, {
                ...options,
                headers: { ...options.headers, Origin: clientOrigin },
            }),
    });
    await expect(client.joinById(localWorldRoomId)).rejects.toThrow();
});

test('a real SDK receives the shared snapshot and client-supplied identity is ignored', async () => {
    const client = new Client(serverOrigin, { headers: { Origin: clientOrigin } });
    const first = await client.joinById(localWorldRoomId, {
        playerId: 'forged',
        worldId: 'forged',
    });

    try {
        const snapshot = await first.request(initialStateRequest);
        expect(snapshot).toMatchObject({
            type: 'movement-snapshot',
            protocolVersion: 3,
            lastProcessedInputSequence: null,
        });
        expect(snapshot.worldId).not.toBe('forged');
        expect(snapshot.player.playerId).not.toBe('forged');
        expect(snapshot.tick).toBeGreaterThanOrEqual(0);
        await first.leave();

        const second = await client.joinById(localWorldRoomId);
        try {
            const rejoined = await second.request(initialStateRequest);
            expect(rejoined.worldId).toBe(snapshot.worldId);
            expect(rejoined.player).toEqual(snapshot.player);
            expect(rejoined.tick).toBeGreaterThanOrEqual(snapshot.tick);
            expect(rejoined.lastProcessedInputSequence).toBeNull();
        } finally {
            await second.leave();
        }
    } finally {
        first.connection.close();
    }
});
