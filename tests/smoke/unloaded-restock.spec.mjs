import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { lootRestockSettings, worldGenerationSettings } from '@zombi-survive/content';
import { copyItem } from '@zombi-survive/domain';
import { generateChunkLoot } from '@zombi-survive/worldgen';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3146';
const start = path => {
    const env = { ...process.env, PORT: '3146', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = fork('tests/fixtures/world-clock-host.mjs', {
        env,
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const checkpoints = [];
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    host.on('message', message => {
        if (message.type === 'clock-checkpoint') checkpoints.push(message.worldTimeMs);
    });
    const exited = new Promise(resolve => host.once('exit', resolve));
    return { host, exited, checkpoints, output: () => output };
};
const stop = async running => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill('SIGTERM');
    await running.exited;
};

test('a registered distant chunk restocks with zero clients and returns one pack after restart', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-distant-stock-live-'));
    const path = join(directory, 'world.sqlite');
    const seed = new SoloWorldStore(path);
    const loot = generateChunkLoot({
        seed: worldGenerationSettings.initialSeed,
        generatorVersion: 1,
        chunkX: 9,
        chunkY: -4,
    });
    const ammo = loot.find(item => item.kind === 'ammo9mm');
    if (ammo === undefined) throw new Error('Missing distant ammo.');
    const period = lootRestockSettings.periodWorldMs;
    const original = {
        type: 'container',
        playerId: seed.initialWorld.playerId,
        item: { itemId: ammo.itemId, kind: 'ammo9mm', quantity: 3 },
        cell: { column: 0, row: 0 },
    };
    seed.saveItemLocations(
        [
            ...seed.initialItemLocations.map(location =>
                location.type === 'container'
                    ? { type: 'expired', item: copyItem(location.item) }
                    : location,
            ),
            ...loot.map(item =>
                item.itemId === ammo.itemId ? original : { type: 'ground', item },
            ),
        ],
        { worldTimeMs: period * 4, restocks: new Map([[ammo.itemId, period]]) },
    );
    seed.close();
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        // A durable checkpoint proves the empty host has stepped, without joining any client.
        await expect.poll(() => running.checkpoints.at(-1) ?? -1).toBeGreaterThan(period * 4);
        await stop(running);
        const saved = new SoloWorldStore(path);
        const replacements = saved.initialItemLocations.filter(location =>
            location.item.itemId.startsWith(`${ammo.itemId}:restock:`),
        );
        expect(replacements).toEqual([
            { type: 'ground', item: { ...ammo, itemId: `${ammo.itemId}:restock:${period}` } },
        ]);
        expect(
            saved.initialItemLocations.find(location => location.item.itemId === ammo.itemId),
        ).toEqual(original);
        expect(saved.initialLootRestocks.has(ammo.itemId)).toBe(false);
        saved.savePosition(ammo.position);
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        const pickup = page.getByRole('button', { name: /^Подобрать патроны 9 мм/ });
        await expect(pickup).toContainText('×8');
        await pickup.click();
        await expect(page.locator('#equipment-weight')).toContainText('132 г');
        await page.reload();
        await expect(page.locator('#equipment-weight')).toContainText('132 г');
        await expect(pickup).toBeHidden();
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
