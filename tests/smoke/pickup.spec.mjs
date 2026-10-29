import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialGroundItem } from '@zombi-survive/content';
import { initialStateRequest, localWorldRoomId, pickupStateRequest } from '@zombi-survive/protocol';

const origin = 'http://127.0.0.1:3111';
const read = page =>
    page.getByRole('status').evaluate(element => ({
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
    }));
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
};

test('pickup and grid moves are server-confirmed, reject invalid placement and survive reconnect', async ({
    page,
    context,
}) => {
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3111', CLIENT_ORIGIN: origin },
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
    let room;

    try {
        await expect.poll(() => output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await expect(page.locator('#ground-item')).toContainText('Бинт');
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 4');
        await expect(page.getByRole('button', { name: 'Подобрать бинт' })).toBeDisabled();
        const client = new Client(origin, { headers: { Origin: origin } });
        room = await client.joinById(localWorldRoomId);
        room.onMessage('pickup-state', () => {});
        room.onMessage('movement-snapshot', () => {});
        const command = {
            type: 'pickup-item',
            protocolVersion: 5,
            itemId: initialGroundItem.itemId,
        };
        const before = await room.request(initialStateRequest);
        // Client position and player identity must not bypass the server's distance check.
        room.send('pickup-item', {
            ...command,
            position: initialGroundItem.position,
            playerId: 'forged',
        });
        await expect
            .poll(async () => (await room.request(initialStateRequest)).tick)
            .toBeGreaterThan(before.tick + 2);
        expect((await room.request(pickupStateRequest)).groundItem).toEqual(initialGroundItem);
        await expect(page.locator('canvas')).toBeVisible();
        await clickWorld(page, 2, 2);
        await expect.poll(async () => (await read(page)).x).toBeCloseTo(2, 1);
        await expect.poll(async () => (await read(page)).y).toBeCloseTo(2, 1);
        await expect(page.locator('canvas')).toHaveAttribute('data-target-visible', 'false');
        await expect(page.getByRole('button', { name: 'Подобрать бинт' })).toBeEnabled();
        await page.screenshot({ path: '.cache/t015-ground-item.png', fullPage: true });
        const invalidAt = await room.request(initialStateRequest);
        for (const value of [
            { ...command, itemId: 'missing' },
            { ...command, protocolVersion: 4 },
            {},
        ])
            room.send('pickup-item', value);
        await expect
            .poll(async () => (await room.request(initialStateRequest)).tick)
            .toBeGreaterThan(invalidAt.tick + 2);
        expect((await room.request(pickupStateRequest)).groundItem).toEqual(initialGroundItem);
        await page.getByRole('button', { name: 'Подобрать бинт' }).click();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 5');
        await expect(page.locator('#ground-item')).toHaveText('На земле: пусто');
        await expect(page.getByRole('button', { name: 'Подобрать предмет' })).toBeDisabled();
        const pickedAt = await room.request(initialStateRequest);
        for (let count = 0; count < 3; count++) room.send('pickup-item', command);
        await expect
            .poll(async () => (await room.request(initialStateRequest)).tick)
            .toBeGreaterThan(pickedAt.tick + 2);
        const state = await room.request(pickupStateRequest);
        expect(state.groundItem).toBeNull();
        expect(state.items.filter(item => item.kind === 'bandage')).toEqual([
            { itemId: initialGroundItem.itemId, kind: 'bandage', cell: { column: 0, row: 0 } },
        ]);
        const grid = page.locator('#inventory-grid');
        const selector = page.getByRole('button', { name: 'Переместить бинт' });
        await expect(grid.locator('[data-occupied="true"]')).toHaveCount(6);
        await expect(page.locator('#inventory-message')).toHaveText('Масса в сетке: 2000 / 2000 г');
        await selector.click();
        await page.getByRole('button', { name: 'Ячейка 4, 1', exact: true }).click();
        await expect(page.locator('#inventory-message')).toContainText('Недостаточно места');
        expect(
            (await room.request(pickupStateRequest)).items.find(item => item.kind === 'bandage')
                .cell,
        ).toEqual({
            column: 0,
            row: 0,
        });
        // Keyboard and pointer use the same accessible cell buttons.
        await page.getByRole('button', { name: 'Ячейка 3, 3', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(grid.locator('[data-column="2"][data-row="2"]')).toHaveAttribute(
            'data-occupied',
            'true',
        );
        await expect(grid.locator('[data-column="0"][data-row="0"]')).toHaveAttribute(
            'data-occupied',
            'false',
        );
        await expect(grid.locator('[data-occupied="true"]')).toHaveCount(6);
        await expect(selector).toHaveAttribute('aria-pressed', 'false');
        const move = {
            type: 'inventory-move',
            protocolVersion: 5,
            inventoryVersion: 2,
            itemId: initialGroundItem.itemId,
            cell: { column: 2, row: 2 },
        };
        const invalidMoveAt = await room.request(initialStateRequest);
        // Forged dimensions/weight/owner cannot make the two-cell item fit at the edge.
        room.send('inventory-move', {
            ...move,
            cell: { column: 3, row: 0 },
            columns: 1,
            weightGrams: 0,
            playerId: 'forged',
        });
        await expect
            .poll(async () => (await room.request(initialStateRequest)).tick)
            .toBeGreaterThan(invalidMoveAt.tick + 2);
        expect(
            (await room.request(pickupStateRequest)).items.find(item => item.kind === 'bandage')
                .cell,
        ).toEqual(move.cell);
        const repeatAt = await room.request(initialStateRequest);
        for (let count = 0; count < 3; count++) room.send('inventory-move', move);
        await expect
            .poll(async () => (await room.request(initialStateRequest)).tick)
            .toBeGreaterThan(repeatAt.tick + 2);
        expect(
            (await room.request(pickupStateRequest)).items.filter(item => item.kind === 'bandage'),
        ).toEqual([{ itemId: move.itemId, kind: 'bandage', cell: move.cell }]);
        await page.screenshot({ path: '.cache/t016-inventory-grid.png', fullPage: true });
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect(page.locator('#inventory')).toHaveText('Контейнер: —');
        await expect(selector).toBeDisabled();
        await expect(grid.locator('[data-occupied="true"]')).toHaveCount(0);
        await expect(grid.locator('button:enabled')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Подобрать предмет' })).toBeDisabled();
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 5');
        await page.reload();
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 5');
        await expect(page.locator('#ground-item')).toHaveText('На земле: пусто');
        await expect(grid.locator('[data-column="2"][data-row="2"]')).toHaveAttribute(
            'data-occupied',
            'true',
        );
        await expect(grid.locator('[data-occupied="true"]')).toHaveCount(6);
        await page.screenshot({ path: '.cache/t016-reloaded.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally {
        room?.connection.close();
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
