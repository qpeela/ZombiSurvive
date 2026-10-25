import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialZombie } from '@zombi-survive/content';
import { localWorldRoomId } from '@zombi-survive/protocol';
import { resolveMovement } from '@zombi-survive/simulation';
import { loadWorldChunks } from '@zombi-survive/worldgen';

const origin = 'http://127.0.0.1:3112';
const readZombies = page =>
    page.locator('canvas').evaluate(element => JSON.parse(element.dataset.zombies ?? '[]'));
const clickWorld = async (page, x, y) => {
    const canvas = page.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const camera = await canvas.evaluate(element => ({
        x: Number(element.dataset.cameraX),
        y: Number(element.dataset.cameraY),
    }));
    const box = await canvas.boundingBox();
    await page.mouse.click(
        box.x + (box.width * (480 + x * 24 - camera.x)) / 960,
        box.y + (box.height * (270 + y * 24 - camera.y)) / 540,
    );
    await expect
        .poll(async () =>
            page
                .getByRole('status')
                .evaluate(
                    (element, target) =>
                        Math.hypot(
                            Number(element.dataset.xMeters) - target.x,
                            Number(element.dataset.yMeters) - target.y,
                        ),
                    { x, y },
                ),
        )
        .toBeLessThan(0.05);
};

test('a server-owned zombie pursues around ruins and is cleared/restored on reconnect', async ({
    page,
    context,
}) => {
    test.setTimeout(45000);
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3112', CLIENT_ORIGIN: origin },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(host, 'exit');
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let observer;
    const samples = [];
    try {
        await expect.poll(() => output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect.poll(async () => (await readZombies(page)).length).toBe(1);
        const zombie = (await readZombies(page))[0];
        expect(zombie.zombieId).toBe(initialZombie.zombieId);
        const playerId = await page.getByRole('status').getAttribute('data-player-id');
        await expect.poll(async () => (await readZombies(page))[0]?.targetPlayerId).toBe(playerId);
        const client = new Client(origin, { headers: { Origin: origin } });
        observer = await client.joinById(localWorldRoomId);
        observer.onMessage('movement-snapshot', () => {});
        observer.onMessage('pickup-state', () => {});
        observer.onMessage('zombie-state', snapshot => {
            if (snapshot.zombies[0]) samples.push(snapshot.zombies[0].position);
        });
        await clickWorld(page, 3, 0);
        await clickWorld(page, 3, 4);
        await clickWorld(page, 8, 4);
        await clickWorld(page, 8, 0);
        // The zombie must cross the east wall's x interval through a clear end.
        await expect
            .poll(async () => (await readZombies(page))[0]?.position.xMeters, { timeout: 20000 })
            .toBeGreaterThan(6.5);
        const obstacles = loadWorldChunks({
            positions: [{ xMeters: 0, yMeters: 0 }],
            previousChunks: [],
        }).flatMap(chunk => chunk.obstacles);
        expect(samples.length).toBeGreaterThan(20);
        for (let index = 1; index < samples.length; index++) {
            const previous = samples[index - 1];
            const current = samples[index];
            const resolved = resolveMovement(previous, current, obstacles);
            expect(resolved.xMeters).toBeCloseTo(current.xMeters, 8);
            expect(resolved.yMeters).toBeCloseTo(current.yMeters, 8);
            expect(
                Math.hypot(current.xMeters - previous.xMeters, current.yMeters - previous.yMeters),
            ).toBeLessThanOrEqual(0.07500001);
        }
        await page.screenshot({ path: '.cache/t017-zombie-pursuit.png', fullPage: true });
        observer.connection.close();
        observer = undefined;
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect.poll(() => readZombies(page)).toEqual([]);
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect.poll(async () => (await readZombies(page)).length).toBe(1);
        expect((await readZombies(page))[0].zombieId).toBe(zombie.zombieId);
        await page.reload();
        await expect.poll(async () => (await readZombies(page)).length).toBe(1);
        expect((await readZombies(page))[0].zombieId).toBe(zombie.zombieId);
        await page.screenshot({ path: '.cache/t017-zombie-reloaded.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally {
        observer?.connection.close();
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
