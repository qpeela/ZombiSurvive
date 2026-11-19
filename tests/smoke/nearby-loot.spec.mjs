import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { localWorldRoomId, protocolVersion } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { movePlayerTo } from '../fixtures/game-controls.mjs';
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
