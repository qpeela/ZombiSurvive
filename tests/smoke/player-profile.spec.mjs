import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { localWorldRoomId } from '@zombi-survive/protocol';

const origin = 'http://127.0.0.1:3116';
const start = path => {
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
        env: {
            ...process.env,
            PORT: '3116',
            CLIENT_ORIGIN: origin,
            WORLD_SAVE_PATH: path,
            COOP_NETWORK: 'lan',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const exited = new Promise(resolve => host.once('exit', resolve));

    return { host, exited, output: () => output };
};
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill('SIGTERM');
    await running.exited;
};
const state = page =>
    page.getByRole('status').evaluate(element => ({
        playerId: element.dataset.playerId,
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
        ack: element.dataset.ack,
    }));
const waitTicks = async (page, count) => {
    const tick = (await state(page)).tick;
    await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(tick + count);
};

test('name validation, safe text, focus, tabs, retry and host restart retain the solo profile', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-profile-'));
    const path = join(directory, 'world.sqlite');
    let running = start(path);
    let room;
    const meleeCommands = [];
    page.on('websocket', socket =>
        socket.on('framesent', event => meleeCommands.push(event.payload.toString())),
    );
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        const input = page.getByRole('textbox', { name: 'Имя игрока' });
        const save = page.getByRole('button', { name: 'Сохранить имя' });
        const label = page.locator('#player-name');
        await expect(input).toHaveValue('Выживший');
        const initial = await state(page);
        await input.fill('');
        await save.click();
        await expect(page.locator('#profile-message')).toContainText('1–24');
        await input.fill('<img src=x>');
        await save.click();
        await expect(page.locator('#profile-message')).toContainText('1–24');
        await expect(page.locator('#player-name img')).toHaveCount(0);
        await input.fill('Я'.repeat(24));
        await save.click();
        await expect(label).toHaveText(`Имя: ${'Я'.repeat(24)}`);
        await input.fill('Иван Петров');
        await save.click();
        await expect(label).toHaveText('Имя: Иван Петров');
        await expect(page.locator('#profile-message')).toHaveText('Имя сохранено у хоста.');
        await page.getByRole('button', { name: 'Экипировать дубинку' }).click();
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: дубинка');
        // Text-entry physical keys must never send movement or attack commands.
        await input.focus();
        const ack = (await state(page)).ack;
        await input.press('Shift+W');
        await input.press('f');
        await input.press('Control');
        await waitTicks(page, 5);
        expect((await state(page)).ack).toBe(ack);
        expect((await state(page)).x).toBe(initial.x);
        expect((await state(page)).y).toBe(initial.y);
        await expect(page.getByRole('status')).toHaveAttribute('data-sneaking', 'false');
        // A held movement key is cancelled as soon as the field receives focus.
        await page.getByRole('heading').click();
        await page.keyboard.down('w');
        await expect.poll(async () => (await state(page)).y).toBeLessThan(initial.y - 0.2);
        await input.focus();
        await page.keyboard.up('w');
        await waitTicks(page, 4);
        const stopped = await state(page);
        await waitTicks(page, 5);
        expect((await state(page)).y).toBe(stopped.y);
        // A second tab receives persisted revisions and can rename the same player.
        const tab = await context.newPage();
        await tab.goto(origin);
        await expect(tab.locator('#player-name')).toHaveText('Имя: Иван Петров');
        await tab.getByRole('textbox', { name: 'Имя игрока' }).fill('Анна-2');
        await tab.getByRole('button', { name: 'Сохранить имя' }).click();
        await expect(label).toHaveText('Имя: Анна-2');
        await tab.close();
        await page.reload();
        await expect(input).toHaveValue('Анна-2');
        await context.setOffline(true);
        await expect(input).toBeDisabled();
        await expect(label).toHaveText('Имя: —');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(input).toHaveValue('Анна-2');
        // Bypass UI to verify authoritative validation and identity selection.
        const client = new Client(origin, { headers: { Origin: origin } });
        room = await client.joinById(localWorldRoomId);
        room.onMessage('*', () => {});
        const request = { type: 'rename-player', protocolVersion: 5, profileVersion: 1 };
        for (const displayName of ['', 'a'.repeat(25), '<script>', 'A\nB']) {
            expect(await room.request('rename-player', { ...request, displayName })).toEqual({
                status: 'invalid',
            });
        }
        const result = await room.request('rename-player', {
            ...request,
            displayName: 'Ёж_42',
            playerId: 'forged',
        });
        expect(result.status).toBe('saved');
        expect(result.profile.playerId).toBe(initial.playerId);
        await room.leave();
        room = undefined;
        await expect(label).toHaveText('Имя: Ёж_42');
        await stop(running);
        const database = new DatabaseSync(path);
        expect(database.prepare('SELECT display_name FROM solo_world').get().display_name).toBe(
            'Ёж_42',
        );
        database.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(input).toHaveValue('Ёж_42');
        expect((await state(page)).playerId).toBe(initial.playerId);
        await page.screenshot({ path: '.cache/t022-player-profile.png', fullPage: true });
        expect(meleeCommands.some(command => command.includes('melee-attack'))).toBe(false);
    } finally {
        if (room !== undefined) await room.leave();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
