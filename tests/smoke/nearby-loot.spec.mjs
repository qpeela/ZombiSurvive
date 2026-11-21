import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { workshopCrate } from '@zombi-survive/content';
import { localWorldRoomId, protocolVersion } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { aimWorld, clickWorld, movePlayerTo } from '../fixtures/game-controls.mjs';
import { openInventory } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3160';
const start = ({ path, now }) => {
    const env = {
        ...process.env,
        PORT: '3160',
        CLIENT_ORIGIN: origin,
        WORLD_SAVE_PATH: path,
        TEST_WALL_CLOCK_MS: String(now),
    };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = fork('tests/fixtures/nearby-host.mjs', {
        env,
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const exited = new Promise(resolve => host.once('exit', resolve));

    return { host, exited, output: () => output };
};

test('Nearby groups visible bodies, explains an unavailable pickup and removes hidden or expired sources', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-nearby-'));
    const path = join(directory, 'world.sqlite');
    const now = Date.now();
    const hour = 3_600_000;
    const startPosition = { xMeters: 1, yMeters: 2 };
    const store = new SoloWorldStore(path);
    const { playerId } = store.initialWorld;
    const bodies = [
        {
            corpseId: 'nearby-first',
            playerId,
            position: startPosition,
            diedAtMs: now - hour,
            expiresAtMs: now + 23 * hour,
        },
        {
            corpseId: 'nearby-second',
            playerId,
            position: { xMeters: 3.5, yMeters: 2 },
            diedAtMs: now,
            expiresAtMs: now + 24 * hour,
        },
    ];
    store.savePosition(startPosition, 14 * hour);
    store.saveCombat(
        { health: 100, cooldownTicks: 0, bleedingTicks: 0 },
        store.initialItemLocations.map(location => {
            const body = { knife: bodies[0], club: bodies[1] }[location.item.kind];

            return body === undefined || location.type !== 'container'
                ? location
                : { type: 'corpse', corpseId: body.corpseId, item: location.item };
        }),
        startPosition,
        bodies,
    );
    store.close();
    const { host, exited, output } = start({ path, now });
    try {
        await expect.poll(output).toContain('Local world ready');
        await page.goto(origin);
        const status = page.getByRole('status');
        const nearby = page.locator('#inventory-panel').getByRole('region', { name: 'Рядом' });
        const nearbyState = nearby.locator('#nearby-state');
        await expect(status).toHaveAttribute('data-status', 'connected');
        await openInventory(page);
        await expect(nearby).toBeVisible();
        const bandage = nearby.getByRole('button', { name: 'Взять: Бинт', exact: true });
        const first = nearby.locator('[data-corpse-id="nearby-first"]');
        const second = nearby.locator('[data-corpse-id="nearby-second"]');
        await expect(bandage).toBeEnabled();
        await expect(first.getByRole('button', { name: 'Взять: Нож' })).toBeEnabled();
        await expect(second.getByRole('button', { name: 'Взять: Дубинка' })).toBeDisabled();
        await expect(second).toContainText('Подойдите ближе.');
        await expect(nearbyState).toBeHidden();
        await nearby.screenshot({ path: '.cache/t069-nearby-loot.png' });

        await movePlayerTo({ page, position: { xMeters: 0, yMeters: -2 } });
        await expect(first).toHaveCount(0);
        await expect(second).toHaveCount(0);
        await expect(bandage).toHaveCount(0);
        await expect(nearbyState).toBeVisible();
        await expect(nearbyState).toHaveText('Видимых источников нет.');

        await movePlayerTo({ page, position: startPosition });
        await expect(first).toBeVisible();
        await expect(second).toBeVisible();
        await expect(bandage).toBeEnabled();
        await page.keyboard.press('Escape');
        await expect(nearby).toHaveCount(0);
        const standalone = page.getByRole('region', { name: 'Рядом' });
        const take = standalone.getByRole('button', { name: 'Взять: Бинт', exact: true });
        await take.focus();
        await page.keyboard.press('Space');
        await expect(take).toHaveCount(0);
        await expect(bandage).toHaveCount(0);
        await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 3');
        await expect(standalone).toBeFocused();
        await openInventory(page);
        host.send({ type: 'advance-wall-clock', nowMs: bodies[0].expiresAtMs + 1 });
        await expect(first).toHaveCount(0);
        await expect(second).toBeVisible();

        host.kill('SIGKILL');
        await exited;
        await expect(status).toHaveAttribute('data-status', 'disconnected');
        await expect(nearbyState).toBeVisible();
        await expect(nearbyState).toHaveText('Ожидание данных от хоста…');
        await expect(second).toHaveCount(0);
    } finally {
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
        rmSync(directory, { recursive: true, force: true });
    }
});

test('loot outline follows the selected source and clears out of loot range or behind a wall', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-loot-outline-'));
    const path = join(directory, 'world.sqlite');
    const now = Date.now();
    const startPosition = { xMeters: 2, yMeters: -2 };
    let running;
    let observer;
    try {
        const store = new SoloWorldStore(path);
        const { playerId } = store.initialWorld;
        const bodies = [
            { corpseId: 'highlight-near', position: { xMeters: 1, yMeters: -2 } },
            { corpseId: 'highlight-wall', position: { xMeters: 8, yMeters: 0 } },
        ].map(body => ({ ...body, playerId, diedAtMs: now, expiresAtMs: now + 86_400_000 }));
        store.saveCombat(
            { health: 100, cooldownTicks: 0, bleedingTicks: 0 },
            store.initialItemLocations.map(location => {
                const body = { knife: bodies[0], club: bodies[1] }[location.item.kind];

                return body === undefined || location.type !== 'container'
                    ? location
                    : { type: 'corpse', corpseId: body.corpseId, item: location.item };
            }),
            startPosition,
            bodies,
        );
        store.close();
        running = start({ path, now });
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await openInventory(page);
        const nearby = page.getByRole('region', { name: 'Рядом' });
        const ground = nearby.locator('#ground-row');
        const nearBody = nearby.locator('[data-corpse-id="highlight-near"]');
        const wallBody = nearby.locator('[data-corpse-id="highlight-wall"]');
        const canvas = page.locator('canvas');
        const status = page.getByRole('status');
        const groundOutline = 'ground:starter-bandage';

        await expect(canvas).toHaveAttribute('data-daylight-phase', 'day');
        await expect(ground).toBeVisible();
        await ground.hover();
        await expect(canvas).toHaveAttribute('data-loot-highlight', groundOutline);
        await nearBody.getByRole('button', { name: 'Взять: Нож' }).focus();
        await expect(canvas).toHaveAttribute('data-loot-highlight', 'corpse:highlight-near');
        await page.screenshot({ path: '.cache/t070-corpse-outline.png' });
        await page.locator('#toggle-inventory').hover();
        await ground.focus();
        await expect(canvas).toHaveAttribute('data-loot-highlight', groundOutline);

        // A second solo session moves the same player while the first tab keeps focus on loot.
        observer = await new Client(origin, { headers: { Origin: origin } }).joinById(
            localWorldRoomId,
        );
        observer.reconnection.enabled = false;
        for (const type of [
            'pickup-state',
            'zombie-state',
            'health-state',
            'melee-state',
            'firearm-state',
            'profile-state',
        ]) {
            observer.onMessage(type, () => {});
        }
        let sequence = 0;
        let target = null;
        let lastSentTick = -Infinity;
        observer.onMessage('movement-snapshot', ({ tick }) => {
            if (target === null || tick - lastSentTick < 4) return;

            lastSentTick = tick;
            observer.send('movement-target', {
                type: 'movement-target',
                protocolVersion,
                sequence: ++sequence,
                target,
                isSprinting: false,
                isSneaking: false,
            });
        });
        const moveFromSecondSession = async position => {
            target = position;
            lastSentTick = -Infinity;
            try {
                await expect
                    .poll(() =>
                        status.evaluate(
                            (element, expected) =>
                                Math.hypot(
                                    Number(element.dataset.xMeters) - expected.xMeters,
                                    Number(element.dataset.yMeters) - expected.yMeters,
                                ),
                            position,
                        ),
                    )
                    .toBeLessThan(0.01);
            } finally {
                target = null;
            }
        };

        await moveFromSecondSession({ xMeters: -4, yMeters: -3 });
        await expect(ground.locator('button')).toHaveAttribute('data-item-id', 'pistol-v1:0:0');
        await expect(ground).toBeVisible();
        await expect(nearby).toBeFocused();
        await expect(canvas).toHaveAttribute('data-loot-highlight', '');

        await moveFromSecondSession(startPosition);
        await expect(ground.locator('button')).toHaveAttribute('data-item-id', 'starter-bandage');
        await ground.focus();
        await expect(canvas).toHaveAttribute('data-loot-highlight', groundOutline);
        await moveFromSecondSession({ xMeters: 2, yMeters: -12 });
        await expect(ground).toBeHidden();
        await expect(nearby).toBeFocused();
        await expect(canvas).toHaveAttribute('data-ground-item-visible', 'false');
        await expect(canvas).toHaveAttribute('data-loot-highlight', '');

        await moveFromSecondSession({ xMeters: 6, yMeters: -4 });
        await expect(wallBody).toBeVisible();
        await wallBody.locator('.loot-row').focus();
        await expect(canvas).toHaveAttribute('data-loot-highlight', 'corpse:highlight-wall');
        await moveFromSecondSession({ xMeters: 2, yMeters: -4 });
        await expect(canvas).toHaveAttribute('data-corpses', /highlight-wall/);
        await expect(wallBody).toHaveCount(0);
        await expect(canvas).toHaveAttribute('data-loot-highlight', '');
    } finally {
        observer?.connection.close();
        if (running !== undefined) {
            if (running.host.exitCode === null && running.host.signalCode === null)
                running.host.kill('SIGKILL');
            await running.exited;
        }
        rmSync(directory, { recursive: true, force: true });
    }
});

test('E selects a visible source near the pointer or the nearest source and keeps right-click shooting', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-world-context-'));
    const path = join(directory, 'world.sqlite');
    const now = Date.now();
    const hour = 3_600_000;
    const startPosition = { xMeters: 1, yMeters: 2 };
    const groundPosition = { xMeters: 2, yMeters: 2 };
    const store = new SoloWorldStore(path);
    const { playerId } = store.initialWorld;
    const body = {
        corpseId: 'world-context-body',
        playerId,
        position: startPosition,
        diedAtMs: now - hour,
        expiresAtMs: now + 23 * hour,
    };
    store.savePosition(startPosition, 14 * hour);
    store.saveCombat(
        { health: 100, cooldownTicks: 0, bleedingTicks: 0 },
        store.initialItemLocations.map(location => {
            if (location.type === 'container' && location.item.kind === 'knife')
                return { type: 'corpse', corpseId: body.corpseId, item: location.item };
            if (location.item.itemId === 'pistol-v1:0:0')
                return {
                    type: 'hands',
                    playerId,
                    item: {
                        itemId: location.item.itemId,
                        kind: 'pistol',
                        magazineCapacity: 8,
                        rounds: 3,
                    },
                };

            return location;
        }),
        startPosition,
        [body],
    );
    store.close();
    const { host, exited, output } = start({ path, now });
    try {
        await expect.poll(output).toContain('Local world ready');
        await page.goto(origin);
        const field = page.getByRole('region', { name: 'Игровое поле' });
        const menu = page.getByRole('region', { name: 'Действия рядом' });
        const take = page.getByRole('button', { name: 'Взять: Бинт', exact: true });
        await expect(take).toBeEnabled();
        await expect(page.locator('#held-ammo')).toContainText('3/8');

        await field.focus();
        await aimWorld({ page, position: { xMeters: 1, yMeters: 4 } });
        await page.keyboard.press('e');
        await menu.getByRole('button', { name: 'Открыть вещи' }).click();
        await expect(menu).toBeHidden();
        const group = page.getByRole('region', { name: /^Тело ·/ });
        await expect(group.getByRole('button', { name: 'Взять: Нож' })).toBeEnabled();
        await expect(group).toBeFocused();

        await field.focus();
        await aimWorld({ page, position: groundPosition });
        await page.keyboard.press('e');
        const action = menu.getByRole('button', { name: 'Взять' });
        await expect(action).toBeFocused();
        await expect(menu).toContainText('Бинт');
        await menu.screenshot({ path: '.cache/t072-world-context.png' });
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(field).toBeFocused();
        await clickWorld({ page, position: groundPosition, button: 'right' });
        await expect(page.locator('#held-ammo')).toContainText('2/8');
        await expect(menu).toBeHidden();
        await page.keyboard.press('e');
        await expect(action).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(take).toHaveCount(0);
        await expect(menu).toBeHidden();

        await page.keyboard.press('e');
        await expect(menu.getByRole('button', { name: 'Открыть вещи' })).toBeFocused();
        host.send({ type: 'advance-wall-clock', nowMs: body.expiresAtMs + 1 });
        await expect(menu).toBeHidden();
        await expect(field).toBeFocused();
        await page.keyboard.press('e');
        await expect(menu).toBeHidden();
    } finally {
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
        await exited;
        rmSync(directory, { recursive: true, force: true });
    }
});

for (const method of ['mouse', 'keyboard']) {
    test(`workshop crate opens and transfers supplies with ${method} and stays empty after restart`, async ({
        page,
    }) => {
        const directory = mkdtempSync(join(tmpdir(), 'zombi-crate-'));
        const path = join(directory, 'world.sqlite');
        const now = Date.now();
        const startPosition = { xMeters: workshopCrate.position.xMeters - 0.9, yMeters: 0 };
        const store = new SoloWorldStore(path);
        store.savePosition(startPosition);
        store.close();

        let running = start({ path, now });
        const crate = page.getByRole('region', { name: workshopCrate.name });
        const take = crate.getByRole('button', { name: 'Взять: Бинт' });
        try {
            await expect.poll(running.output).toContain('Local world ready');
            await page.goto(origin);
            await expect(take).toBeEnabled();
            await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');

            if (method === 'keyboard') {
                await aimWorld({ page, position: workshopCrate.position });
                await page.locator('#game').press('e');
                const open = page.getByRole('button', { name: 'Открыть ящик' });
                await expect(open).toBeFocused();
                await page.keyboard.press('Enter');
                await expect(crate).toBeFocused();
                await page.keyboard.press('Tab');
                await expect(take).toBeFocused();
                await page.keyboard.press('Enter');
            } else {
                await take.click();
            }
            await expect(crate).toContainText('Ящик пуст.');
            await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 5');

            running.host.kill('SIGKILL');
            await running.exited;
            running = start({ path, now });
            await expect.poll(running.output).toContain('Local world ready');
            await page.goto(origin);
            await expect(crate).toContainText('Ящик пуст.');
            await expect(page.locator('#inventory')).toHaveText('Контейнер: предметов 5');
        } finally {
            if (running.host.exitCode === null && running.host.signalCode === null)
                running.host.kill('SIGKILL');
            await running.exited;
            rmSync(directory, { recursive: true, force: true });
        }
    });
}

test('the workshop crate accepts inventory items, refuses another at capacity and retains supplies after restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-crate-storage-'));
    const path = join(directory, 'world.sqlite');
    const now = Date.now();
    const store = new SoloWorldStore(path);
    store.savePosition({ xMeters: workshopCrate.position.xMeters - 0.9, yMeters: 0 });
    store.close();
    let running = start({ path, now });
    const crate = page.getByRole('region', { name: workshopCrate.name });
    const capacity = String(workshopCrate.capacity);
    const inventory = page.locator('#inventory-panel');
    const takeBandage = crate.getByRole('button', { name: 'Взять: Бинт' });
    const inventoryItem = name =>
        inventory.getByRole('button', {
            name: name === 'Бинт' ? /^Переместить бинт/ : `Переместить: ${name}`,
        });
    const showStoreAction = async name => {
        const item = inventoryItem(name);
        await expect(item).toBeEnabled();
        await item.press('Shift+F10');
        const action = page.getByRole('menuitem', { name: 'Положить в ящик', exact: true });
        await expect(action).toBeVisible();
        return action;
    };
    const putInCrate = async name => {
        const action = await showStoreAction(name);
        await action.click();
        await expect(
            crate.getByRole('button', { name: `Взять: ${name}`, exact: true }),
        ).toBeVisible();
        if (name === 'Бинт') await expect(inventoryItem(name)).toBeDisabled();
        else await expect(inventoryItem(name)).toHaveCount(0);
    };
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(takeBandage).toBeEnabled();
        await openInventory(page);
        await takeBandage.click();
        await expect(crate.getByText('Ящик пуст.', { exact: true })).toBeVisible();
        await putInCrate('Бинт');
        await takeBandage.click();
        await expect(inventoryItem('Бинт')).toBeEnabled();
        await putInCrate('Бинт');

        for (const name of ['Дубинка', 'Нож', 'Лом']) await putInCrate(name);
        await expect(crate).toContainText(`Занято ${capacity} из ${capacity}`);
        const full = await showStoreAction('Топор');
        await expect(full).toHaveAttribute('aria-disabled', 'true');
        await expect(full).toHaveAccessibleDescription('Ящик заполнен.');
        await full.press('Enter');
        await expect(inventoryItem('Топор')).toBeVisible();

        running.host.kill('SIGKILL');
        await running.exited;
        running = start({ path, now });
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(crate).toContainText(`Занято ${capacity} из ${capacity}`);
        await openInventory(page);
        await expect(inventoryItem('Топор')).toBeVisible();
        await expect(inventoryItem('Бинт')).toBeDisabled();
    } finally {
        if (running.host.exitCode === null && running.host.signalCode === null)
            running.host.kill('SIGKILL');
        await running.exited;
        rmSync(directory, { recursive: true, force: true });
    }
});
