import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { localWorldRoomId, protocolVersion } from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

const origin = 'http://127.0.0.1:3143';

test('the same seven-metre route uses more stamina with a visible authoritative load', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-loaded-route-'));
    const results = [];
    try {
        for (const isHeavy of [false, true]) {
            const path = join(directory, `${String(isHeavy)}.sqlite`);
            const store = new SoloWorldStore(path);
            store.savePosition({ xMeters: 8, yMeters: 12 });
            if (!isHeavy)
                store.saveItemLocations(
                    store.initialItemLocations.map(location =>
                        location.type === 'container'
                            ? { type: 'expired', item: location.item }
                            : location,
                    ),
                );
            store.close();
            const env = {
                ...process.env,
                PORT: '3143',
                CLIENT_ORIGIN: origin,
                WORLD_SAVE_PATH: path,
            };
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
            const exited = new Promise(resolve => host.once('exit', resolve));
            let room;
            let heartbeat;
            try {
                await expect.poll(() => output).toContain('Local world ready');
                await page.goto(origin);
                await expect(page.locator('#load-label')).toHaveText(
                    isHeavy
                        ? 'Нагрузка: 1900 г · Расход спринта: ×1,95'
                        : 'Нагрузка: 0 г · Расход спринта: ×1,00',
                );
                room = await new Client(origin, { headers: { Origin: origin } }).joinById(
                    localWorldRoomId,
                );
                room.reconnection.enabled = false;
                for (const type of [
                    'pickup-state',
                    'zombie-state',
                    'health-state',
                    'melee-state',
                    'profile-state',
                    'melee-action',
                    'firearm-state',
                    'shot-action',
                ])
                    room.onMessage(type, () => {});
                let result;
                room.onMessage('movement-snapshot', snapshot => {
                    const isAtDestination = Math.abs(snapshot.player.position.yMeters - 5) < 1e-6;
                    if (result === undefined && isAtDestination) result = snapshot.player;
                });
                let sequence = 0;
                const sendTarget = () =>
                    room.send('movement-target', {
                        type: 'movement-target',
                        protocolVersion,
                        sequence: ++sequence,
                        target: { xMeters: 8, yMeters: 5 },
                        isSprinting: true,
                        isSneaking: false,
                    });
                sendTarget();
                heartbeat = setInterval(sendTarget, 100);
                await expect.poll(() => result).toBeDefined();
                results.push(result);
                if (isHeavy)
                    await page.screenshot({ path: '.cache/t049-loaded-route.png', fullPage: true });
            } finally {
                clearInterval(heartbeat);
                room?.connection.close();
                if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
                await exited;
            }
        }
        expect(results[0].position.yMeters).toBeCloseTo(5, 8);
        expect(results[1].position.yMeters).toBeCloseTo(5, 8);
        expect(results[0].stamina).toBeCloseTo(0.8, 8);
        expect(results[1].stamina).toBeCloseTo(0.61, 8);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
