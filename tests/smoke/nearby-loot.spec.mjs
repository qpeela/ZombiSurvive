import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { movePlayerTo } from '../fixtures/game-controls.mjs';
import { openInventory } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3160';

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
    try {
        await expect.poll(() => output).toContain('Local world ready');
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
