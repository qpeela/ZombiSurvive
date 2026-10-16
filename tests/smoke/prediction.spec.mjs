import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const state = page =>
    page.evaluate(() => {
        const status = globalThis.document.querySelector('[role="status"]');
        const canvas = globalThis.document.querySelector('canvas');

        return {
            confirmedX: Number(status.dataset.xMeters),
            confirmedY: Number(status.dataset.yMeters),
            visibleX: (Number(canvas.dataset.playerX) - 480) / 24,
            visibleY: (Number(canvas.dataset.playerY) - 270) / 24,
        };
    });
const converge = async page => {
    await expect
        .poll(async () => {
            const current = await state(page);
            return Math.hypot(
                current.visibleX - current.confirmedX,
                current.visibleY - current.confirmedY,
            );
        })
        .toBeLessThan(0.000001);
};
const clickWorld = async (page, x, y) => {
    const current = await state(page);
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.click(
        box.x + (box.width * (480 + (x - current.visibleX) * 24)) / 960,
        box.y + (box.height * (270 + (y - current.visibleY) * 24)) / 540,
    );
};

test('held transport shows predicted input before acknowledgement and reconciles at walls', async ({
    page,
}) => {
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
        env: { ...process.env, PORT: '3104' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    host.stdout.on('data', chunk => {
        output += chunk.toString();
    });
    host.stderr.on('data', chunk => {
        output += chunk.toString();
    });
    const exited = new Promise(resolve => host.once('exit', resolve));
    let isHeld = false;
    const queued = [];
    const release = () => {
        isHeld = false;
        for (const forward of queued.splice(0)) forward();
    };

    try {
        await expect.poll(() => output).toContain('Local world ready');
        // A controlled gate preserves packet order and makes the pre-ack assertion
        // independent of machine speed. No real network latency is assumed.
        await page.routeWebSocket('**', socket => {
            const server = socket.connectToServer();
            const forward = (destination, message) => {
                if (isHeld) queued.push(() => destination.send(message));
                else destination.send(message);
            };
            socket.onMessage(message => forward(server, message));
            server.onMessage(message => forward(socket, message));
        });
        await page.addInitScript(() => {
            const Socket = globalThis.WebSocket;
            globalThis.WebSocket = class extends Socket {
                constructor(url, protocols) {
                    // Match native browser validation under Playwright's WebSocket mock,
                    // as in the existing handshake smoke: Colyseus probes Node options first.
                    const isOptionsObject = typeof protocols === 'object' && protocols !== null;
                    const isProtocolsArray = Array.isArray(protocols);

                    if (isOptionsObject && !isProtocolsArray) {
                        throw new TypeError('Browser WebSocket does not support Node options.');
                    }

                    super(url, protocols);
                }
            };
        });
        await page.goto('http://127.0.0.1:3104/');
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
        await page.getByRole('heading').click();
        const start = await state(page);
        isHeld = true;
        await page.keyboard.down('d');
        await expect
            .poll(async () => (await state(page)).visibleX)
            .toBeGreaterThan(start.visibleX + 0.2);
        expect((await state(page)).confirmedX).toBe(start.confirmedX);
        await page.keyboard.up('d');
        release();
        await expect(page.getByRole('status')).not.toHaveAttribute('data-ack', 'null');
        await converge(page);
        await page.locator('canvas').scrollIntoViewIfNeeded();
        await clickWorld(page, 4, 0);
        await expect.poll(async () => (await state(page)).confirmedX).toBeCloseTo(4, 1);
        await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
        await converge(page);

        isHeld = true;
        await clickWorld(page, 8, 0);
        await expect.poll(async () => (await state(page)).visibleX).toBeCloseTo(4.65, 10);
        expect((await state(page)).confirmedX).toBeCloseTo(4, 1);
        await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'true');
        await mkdir('.cache', { recursive: true });
        await page.screenshot({ path: '.cache/t008-prediction.png', fullPage: true });
        release();
        await expect.poll(async () => (await state(page)).confirmedX).toBe(4.65);
        await converge(page);
        await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
        await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
        await converge(page);
        await page.reload();
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await converge(page);
        expect((await state(page)).confirmedX).toBe(4.65);
        await expect(page.getByRole('status')).toHaveAttribute('data-ack', 'null');
    } finally {
        release();
        await page.close();
        if (host.exitCode === null) host.kill('SIGTERM');
        await exited;
    }
});
