import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

const entrypoint = resolve('apps/server/dist/main.js');
const start = (path, port, cwd) => {
    const env = { ...process.env, WORLD_SAVE_PATH: path, PORT: String(port), COOP_NETWORK: 'lan' };
    delete env.COOP_HOST;
    const host = spawn(process.execPath, [entrypoint], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    host.stdout.on('data', chunk => {
        output += chunk.toString();
    });
    host.stderr.on('data', chunk => {
        output += chunk.toString();
    });
    const exited = new Promise(resolve =>
        host.once('exit', (code, signal) => resolve({ code, signal })),
    );

    return { host, exited, output: () => output };
};
const stop = async (running, signal = 'SIGTERM') => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill(signal);

    return running.exited;
};
const read = page =>
    page.getByRole('status').evaluate(element => ({
        worldId: element.dataset.worldId,
        playerId: element.dataset.playerId,
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
        ack: element.dataset.ack,
    }));
const connect = async (page, port) => {
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
};

test('solo restart restores a neighbouring chunk in a fresh browser, port and working directory', async ({
    page,
    browser,
}) => {
    test.setTimeout(35000);
    const directory = mkdtempSync(join(tmpdir(), 'zombi-restart-'));
    const path = join(directory, 'world.sqlite');
    let running = start(path, 3109);
    let fresh;

    try {
        await expect.poll(running.output).toContain('Local world ready');
        await connect(page, 3109);
        const initial = await read(page);
        await page.getByRole('heading').click();
        await page.keyboard.down('w');
        await expect.poll(async () => (await read(page)).y, { timeout: 15000 }).toBeLessThan(-34);
        await page.keyboard.up('w');
        const released = await read(page);
        await expect.poll(async () => (await read(page)).tick).toBeGreaterThan(released.tick + 4);
        const saved = await read(page);
        expect(saved.worldId).toBe(initial.worldId);
        expect(await stop(running, 'SIGINT')).toEqual({ code: 0, signal: null });
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        running = start(path, 3110, tmpdir());
        await expect.poll(running.output).toContain('Local world ready');
        fresh = await browser.newContext();
        const restoredPage = await fresh.newPage();
        await connect(restoredPage, 3110);
        const restored = await read(restoredPage);
        expect(restored).toMatchObject({
            worldId: saved.worldId,
            playerId: saved.playerId,
            x: saved.x,
            y: saved.y,
        });
        expect(restored.ack).toBe('null');
        await expect
            .poll(async () => (await read(restoredPage)).tick)
            .toBeGreaterThan(restored.tick + 5);
        expect(await read(restoredPage)).toMatchObject({ x: saved.x, y: saved.y });
        await restoredPage.reload();
        await expect(restoredPage.getByRole('status')).toHaveAttribute('data-status', 'connected');
        expect(await read(restoredPage)).toMatchObject({
            worldId: saved.worldId,
            playerId: saved.playerId,
            x: saved.x,
            y: saved.y,
        });
        for (const route of ['/.local/solo.sqlite', '/world.sqlite']) {
            expect((await restoredPage.request.get(`http://127.0.0.1:3110${route}`)).status()).toBe(
                404,
            );
        }
    } finally {
        await fresh?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('periodic checkpoint survives SIGKILL and a second host cannot overwrite the same save', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-checkpoint-'));
    const path = join(directory, 'world.sqlite');
    let running = start(path, 3109);
    let room;

    try {
        await expect.poll(running.output).toContain('Local world ready');
        const second = start(path, 3110);
        try {
            expect(await second.exited).toEqual({ code: 1, signal: null });
            expect(second.output()).toContain('locked');
            expect(second.output()).not.toContain('Local world ready');
        } finally {
            await stop(second);
        }
        const client = new Client('http://127.0.0.1:3109', {
            headers: { Origin: 'http://127.0.0.1:3109' },
        });
        room = await client.joinById(localWorldRoomId);
        room.reconnection.enabled = false;
        room.onMessage('movement-snapshot', () => undefined);
        room.send('movement-target', {
            type: 'movement-target',
            protocolVersion: 5,
            sequence: 1,
            target: { xMeters: 0, yMeters: -1 },
            isSprinting: false,
            isSneaking: false,
        });
        await expect
            .poll(async () => (await room.request(initialStateRequest)).player.position.yMeters)
            .toBe(-1);
        const saved = await room.request(initialStateRequest);
        const modified = statSync(path, { bigint: true }).mtimeNs;
        await expect.poll(() => statSync(path, { bigint: true }).mtimeNs > modified).toBe(true);
        // The request runs after the synchronous checkpoint commits, before killing the host.
        await room.request(initialStateRequest);
        await stop(running, 'SIGKILL');
        running = start(path, 3109);
        await expect.poll(running.output).toContain('Local world ready');
        room = await client.joinById(localWorldRoomId);
        room.reconnection.enabled = false;
        room.onMessage('movement-snapshot', () => undefined);
        expect(await room.request(initialStateRequest)).toMatchObject({
            worldId: saved.worldId,
            player: saved.player,
            lastProcessedInputSequence: null,
        });
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('load and periodic write failures stop the host without replacing the last good save', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-save-errors-'));
    const path = join(directory, 'world.sqlite');
    let running;

    try {
        writeFileSync(path, 'corrupt save');
        running = start(path, 3109);
        expect(await running.exited).toEqual({ code: 1, signal: null });
        expect(running.output()).not.toContain('Local world ready');
        expect(readFileSync(path, 'utf8')).toBe('corrupt save');
        rmSync(path);
        running = start(path, 3109);
        await expect.poll(running.output).toContain('Local world ready');
        await stop(running);
        const database = new DatabaseSync(path);
        const saved = database.prepare('SELECT * FROM solo_world').get();
        database.exec(`CREATE TRIGGER reject_save BEFORE UPDATE ON solo_world
            BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END`);
        database.close();
        running = start(path, 3109);
        await expect.poll(running.output).toContain('Local world ready');
        expect(await running.exited).toEqual({ code: 1, signal: null });
        expect(running.output()).toContain(
            'Solo save failed; stopping host: simulated disk failure',
        );
        const restored = new DatabaseSync(path);
        expect(restored.prepare('SELECT * FROM solo_world').get()).toEqual(saved);
        restored.close();
    } finally {
        if (running !== undefined) await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
