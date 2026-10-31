import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { meleeWeapons } from '@zombi-survive/content';
import { localWorldRoomId, meleeVersion, protocolVersion } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3124';
const start = path => {
    const env = { ...process.env, PORT: '3124', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = spawn(process.execPath, [resolve('apps/server/dist/main.js')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
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
const seed = (path, health = 100, position = { xMeters: 0, yMeters: 0 }) => {
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    store.savePosition(position);
    store.saveCombat(
        { health, cooldownTicks: 0, bleedingTicks: 0 },
        store.initialItemLocations.map(location =>
            location.item.itemId === `${playerId}:axe`
                ? { type: 'hands', playerId, item: location.item }
                : location,
        ),
    );
    store.close();
    return playerId;
};
const connect = async () => {
    const room = await new Client(origin, { headers: { Origin: origin } }).joinById(
        localWorldRoomId,
    );
    room.reconnection.enabled = false;
    for (const type of [
        'movement-snapshot',
        'pickup-state',
        'zombie-state',
        'health-state',
        'melee-state',
        'profile-state',
        'melee-action',
    ])
        room.onMessage(type, () => {});
    return room;
};
const attack = room =>
    room.send('melee-attack', { type: 'melee-attack', protocolVersion, meleeVersion });
const open = async page => {
    await page.goto(origin);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
};

for (const health of [70, 0]) {
    test(`${health} HP survives tabs, reload, retry and SIGKILL/restart with saved hands`, async ({
        page,
        context,
        browser,
    }) => {
        const directory = mkdtempSync(join(tmpdir(), 'zombi-health-persist-'));
        const path = join(directory, 'world.sqlite');
        seed(path, health, { xMeters: 8, yMeters: 12 });
        let running = start(path);
        let tab;
        let fresh;
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await expect.poll(running.output).toContain('Local world ready');
            await open(page);
            tab = await context.newPage();
            await open(tab);
            for (const view of [page, tab]) {
                await expect(view.locator('#health-label')).toHaveText(`Здоровье: ${health} / 100`);
                await expect(view.locator('#weapon-label')).toHaveText('Оружие: топор');
            }
            // Remove all connected targets so the zombie cannot change HP during the retry.
            await context.setOffline(true);
            await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
            await context.setOffline(false);
            await page.getByRole('button', { name: 'Подключиться снова' }).click();
            await expect(page.locator('#health-label')).toHaveText(`Здоровье: ${health} / 100`);
            await page.reload();
            await expect(page.locator('#health-label')).toHaveText(`Здоровье: ${health} / 100`);
            await stop(running, 'SIGKILL');
            running = start(path);
            await expect.poll(running.output).toContain('Local world ready');
            fresh = await browser.newContext();
            const restored = await fresh.newPage();
            await open(restored);
            await expect(restored.locator('#health-label')).toHaveText(`Здоровье: ${health} / 100`);
            await expect(restored.locator('#weapon-label')).toHaveText('Оружие: топор');
            if (health === 0)
                await expect(
                    restored.getByRole('button', { name: 'Ударить (F)', exact: true }),
                ).toBeDisabled();
            await restored.screenshot({
                path: `.cache/t029-restored-${health}-hp.png`,
                fullPage: true,
            });
            expect(errors).toEqual([]);
        } finally {
            await tab?.close();
            await fresh?.close();
            await stop(running);
            rmSync(directory, { recursive: true, force: true });
        }
    });
}

test('confirmed swing is durable before SIGKILL; faster equipment cannot bypass restored cooldown', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-cooldown-persist-'));
    const path = join(directory, 'world.sqlite');
    const playerId = seed(path);
    let running = start(path);
    let room;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        const confirmed = new Promise(resolve =>
            room.onMessage('melee-action', action => {
                running.host.kill('SIGKILL');
                resolve(action);
            }),
        );
        attack(room);
        expect((await confirmed).weapon).toBe('axe');
        await running.exited;
        room.connection.close();
        const store = new SoloWorldStore(path);
        const saved = store.initialCombat;
        expect(saved.cooldownTicks).toBe(meleeWeapons.axe.cooldownTicks);
        expect(saved.health).toBe(100);
        store.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        const actions = [];
        room.onMessage('melee-action', action => actions.push(action));
        room.send('equip-weapon', {
            type: 'equip-weapon',
            protocolVersion,
            meleeVersion,
            itemId: `${playerId}:knife`,
        });
        room.onMessage('movement-snapshot', snapshot => {
            if (snapshot.tick % 5 === 0) attack(room);
        });
        attack(room);
        await expect.poll(() => actions.length).toBeGreaterThan(0);
        expect(actions[0].tick).toBeGreaterThanOrEqual(saved.cooldownTicks);
        expect(actions[0].weapon).toBe('knife');
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('acknowledged zombie damage survives immediate SIGKILL and a new host', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-damage-persist-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    let running = start(path);
    let room;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        const damaged = new Promise(resolve =>
            room.onMessage('health-state', state => {
                if (state.health < 100) {
                    running.host.kill('SIGKILL');
                    resolve(state.health);
                }
            }),
        );
        const health = await damaged;
        await running.exited;
        room.connection.close();
        const store = new SoloWorldStore(path);
        expect(store.initialCombat.health).toBe(health);
        store.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        const restored = await new Promise(resolve =>
            room.onMessage('health-state', state => resolve(state.health)),
        );
        expect(restored).toBe(health);
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

for (const action of ['health', 'attack']) {
    test(`failed ${action} commit stops the real host without publishing a transient result`, async () => {
        const directory = mkdtempSync(join(tmpdir(), 'zombi-combat-failure-'));
        const path = join(directory, 'world.sqlite');
        seed(path);
        const database = new DatabaseSync(path);
        database.exec(`CREATE TRIGGER reject_combat BEFORE UPDATE OF combat_state ON solo_world
            BEGIN SELECT RAISE(ABORT, 'fixture combat failure'); END`);
        database.close();
        const running = start(path);
        let room;
        const received = [];
        const actions = [];
        try {
            await expect.poll(running.output).toContain('Local world ready');
            room = await connect();
            room.onMessage('health-state', state => received.push(state));
            room.onMessage('melee-action', state => actions.push(state));
            if (action === 'attack') attack(room);
            expect(await running.exited).toEqual({ code: 1, signal: null });
            expect(running.output()).toContain(
                'Solo save failed; stopping host: fixture combat failure',
            );
            expect(received.every(state => state.health === 100)).toBe(true);
            expect(actions).toEqual([]);
            const restored = new SoloWorldStore(path);
            expect(restored.initialCombat).toEqual({
                health: 100,
                cooldownTicks: 0,
                bleedingTicks: 0,
            });
            restored.close();
        } finally {
            room?.connection.close();
            await stop(running);
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
