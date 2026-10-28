import { spawn } from 'node:child_process';

import { expect, test } from '@playwright/test';

const start = port => {
    const origin = `http://127.0.0.1:${String(port)}`;
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const exited = new Promise(resolve => host.once('exit', resolve));

    return { host, origin, exited, output: () => output };
};
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill('SIGTERM');
    await running.exited;
};
const open = async (page, running) => {
    await expect.poll(running.output).toContain('Local world ready');
    await page.goto(running.origin);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
};
const aim = async (page, x, y) => {
    const canvas = page.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
    await expect(canvas).toHaveAttribute('data-aim-visible', 'true');
    await expect
        .poll(async () => Number(await canvas.getAttribute('data-weapon-angle')))
        .toBeCloseTo(Math.atan2((y - 0.5) * 540, (x - 0.5) * 960), 1);
};
const assertAttached = async page => {
    await expect
        .poll(() =>
            page.locator('canvas').evaluate(canvas => {
                const dx = Number(canvas.dataset.weaponX) - Number(canvas.dataset.playerX);
                const dy = Number(canvas.dataset.weaponY) - Number(canvas.dataset.playerY);
                return Math.hypot(dx, dy);
            }),
        )
        .toBeLessThan(0.01);
};
const waitTicks = async page => {
    const status = page.getByRole('status');
    const tick = Number(await status.getAttribute('data-tick'));
    await expect
        .poll(async () => Number(await status.getAttribute('data-tick')))
        .toBeGreaterThan(tick + 4);
};

test('four visible weapons follow predicted player and aim through resize, disconnect and recreated scene', async ({
    page,
    context,
}) => {
    const running = start(3117);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await open(page, running);
        const canvas = page.locator('canvas');
        await expect(canvas).toHaveAttribute('data-weapon-visible', 'false');
        const weapons = [
            ['club', 'дубинку'],
            ['knife', 'нож'],
            ['crowbar', 'лом'],
            ['axe', 'топор'],
        ];
        for (const [weapon, label] of weapons) {
            await page.getByRole('button', { name: `Экипировать ${label}`, exact: true }).click();
            await expect(canvas).toHaveAttribute('data-weapon', weapon);
            await expect(canvas).toHaveAttribute('data-weapon-visible', 'true');
            await aim(page, 0.7, 0.5);
            await assertAttached(page);
            await canvas.screenshot({ path: `.cache/t023-${weapon}.png` });
        }
        await aim(page, 0.3, 0.35);
        await assertAttached(page);
        const startY = Number(await canvas.getAttribute('data-player-y'));
        await page.keyboard.down('w');
        await expect
            .poll(async () => Number(await canvas.getAttribute('data-player-y')))
            .toBeLessThan(startY - 10);
        await assertAttached(page);
        await page.keyboard.up('w');
        await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
        await page.setViewportSize({ width: 900, height: 800 });
        await aim(page, 0.75, 0.7);
        await assertAttached(page);
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect(canvas).toHaveAttribute('data-weapon-visible', 'false');
        await expect(canvas).toHaveAttribute('data-weapon', '');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(canvas).toHaveAttribute('data-weapon', 'axe');
        await expect(canvas).toHaveAttribute('data-weapon-visible', 'true');
        await page.reload();
        await expect(page.locator('canvas')).toHaveCount(1);
        await expect(canvas).toHaveAttribute('data-weapon', 'axe');
        await expect(canvas).toHaveAttribute('data-weapon-visible', 'true');
        await aim(page, 0.7, 0.4);
        await assertAttached(page);
        expect(errors).toEqual([]);
    } finally {
        await stop(running);
    }
});

test('held equip requests cannot change the rendered weapon before server confirmation', async ({
    page,
}) => {
    const running = start(3118);
    let isHeld = false;
    const queued = [];
    const release = () => {
        isHeld = false;
        for (const send of queued.splice(0)) send();
    };
    try {
        await page.routeWebSocket('**', socket => {
            const server = socket.connectToServer();
            socket.onMessage(message => {
                if (isHeld) queued.push(() => server.send(message));
                else server.send(message);
            });
            server.onMessage(message => socket.send(message));
        });
        await page.addInitScript(() => {
            const Socket = globalThis.WebSocket;
            globalThis.WebSocket = class extends Socket {
                constructor(url, protocols) {
                    const isOptionsObject = typeof protocols === 'object' && protocols !== null;
                    const isProtocolsArray = Array.isArray(protocols);
                    if (isOptionsObject && !isProtocolsArray)
                        throw new TypeError('Browser WebSocket does not support Node options.');
                    super(url, protocols);
                }
            };
        });
        await open(page, running);
        const canvas = page.locator('canvas');
        isHeld = true;
        await page.getByRole('button', { name: 'Экипировать топор' }).click();
        await waitTicks(page);
        await expect(canvas).toHaveAttribute('data-weapon-visible', 'false');
        release();
        await expect(canvas).toHaveAttribute('data-weapon', 'axe');
        isHeld = true;
        await page.getByRole('button', { name: 'Экипировать нож' }).click();
        await waitTicks(page);
        await expect(canvas).toHaveAttribute('data-weapon', 'axe');
        release();
        await expect(canvas).toHaveAttribute('data-weapon', 'knife');
    } finally {
        release();
        await page.close();
        await stop(running);
    }
});
