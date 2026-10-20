import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { collisionSettings } from '@zombi-survive/content';
import { initialWorldChunk } from '@zombi-survive/worldgen';

const position = page =>
    page.getByRole('status').evaluate(element => ({
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
    }));
const clickWorld = async (page, x, y) => {
    const canvas = page.locator('canvas');
    const camera = await canvas.evaluate(element => ({
        x: Number(element.dataset.cameraX),
        y: Number(element.dataset.cameraY),
    }));
    const box = await canvas.boundingBox();
    await page.mouse.click(
        box.x + (box.width * (480 + x * 24 - camera.x)) / 960,
        box.y + (box.height * (270 + y * 24 - camera.y)) / 540,
    );
};
const arrive = async (page, x, y) => {
    await clickWorld(page, x, y);
    await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
    await expect.poll(async () => (await position(page)).x).toBeCloseTo(x, 1);
    await expect.poll(async () => (await position(page)).y).toBeCloseTo(y, 1);
};

test('one reproducible chunk renders and its procedural rocks stop server and predicted movement after reload', async ({
    page,
}) => {
    test.setTimeout(45000);
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
        env: { ...process.env, PORT: '3108' },
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
    try {
        await expect.poll(() => output).toContain('Local world ready');
        await page.goto('http://127.0.0.1:3108/');
        const canvas = page.locator('canvas');
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(canvas).toHaveAttribute('data-player-visible', 'true');
        const metadata = JSON.parse(await canvas.getAttribute('data-world-chunk'));
        expect(metadata).toEqual({
            seed: initialWorldChunk.seed,
            generatorVersion: 1,
            chunkX: 0,
            chunkY: 0,
            terrainTileCount: 1024,
        });
        expect(JSON.parse(await canvas.getAttribute('data-obstacles'))).toEqual(
            initialWorldChunk.obstacles,
        );
        await page.locator('canvas').scrollIntoViewIfNeeded();
        await mkdir('.cache', { recursive: true });
        await page.screenshot({ path: '.cache/t011-world-origin.png', fullPage: true });
        const rock = initialWorldChunk.obstacles.find(
            obstacle =>
                obstacle.id.includes(':rock:') &&
                obstacle.minXMeters > 0 &&
                obstacle.minYMeters < 0,
        );
        const y = (rock.minYMeters + rock.maxYMeters) / 2;
        // Waypoints stay inside the viewport; central corridor avoids the starting ruins.
        await arrive(page, 0, -9);
        await arrive(page, 0, -18);
        await arrive(page, 0, y);
        await arrive(page, 9, y);
        await arrive(page, 16, y);
        await clickWorld(page, rock.maxXMeters + 1, y);
        const boundary = rock.minXMeters - collisionSettings.playerHalfSizeMeters;
        await expect.poll(async () => (await position(page)).x).toBeCloseTo(boundary, 8);
        const blocked = await position(page);
        await expect
            .poll(async () => (await position(page)).tick)
            .toBeGreaterThan(blocked.tick + 12);
        expect((await position(page)).x).toBeCloseTo(boundary, 8);
        await expect
            .poll(async () => (Number(await canvas.getAttribute('data-player-x')) - 480) / 24)
            .toBeCloseTo(boundary, 8);
        await page.screenshot({ path: '.cache/t011-procedural-rock.png', fullPage: true });
        await page.reload();
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(canvas).toHaveAttribute('data-player-visible', 'true');
        expect(JSON.parse(await canvas.getAttribute('data-world-chunk'))).toEqual(metadata);
        expect(JSON.parse(await canvas.getAttribute('data-obstacles'))).toEqual(
            initialWorldChunk.obstacles,
        );
        expect((await position(page)).x).toBeCloseTo(boundary, 8);
        await expect(canvas).toHaveAttribute('data-target-visible', 'false');
    } finally {
        if (host.exitCode === null) host.kill('SIGTERM');
        await exited;
    }
});
