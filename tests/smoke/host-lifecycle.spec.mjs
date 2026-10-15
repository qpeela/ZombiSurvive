import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

test('host startup rejects invalid Tailscale configuration before opening the world', async () => {
    for (const config of [
        { COOP_NETWORK: 'tailscale', COOP_HOST: '' },
        { COOP_NETWORK: 'tailscale', COOP_HOST: '127.0.0.1' },
        { COOP_NETWORK: 'tailscale', COOP_HOST: '192.168.1.5' },
        { COOP_NETWORK: 'tailcsale', COOP_HOST: '' },
    ]) {
        const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
            env: { ...process.env, ...config, PORT: '3102' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const exited = once(host, 'exit');
        let output = '';
        host.stdout.on('data', chunk => {
            output += chunk.toString();
        });
        host.stderr.on('data', chunk => {
            output += chunk.toString();
        });

        try {
            expect(await exited).toEqual([1, null]);
            expect(output).toContain('COOP_');
            expect(output).not.toContain('Local world ready');
            expect(output).not.toContain('Invitations file:');
        } finally {
            if (host.exitCode === null) {
                host.kill('SIGKILL');
            }

            await exited;
        }
    }
});

test('stopping the host disconnects joined clients and releases the server process', async () => {
    const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
        env: { ...process.env, PORT: '3102' },
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
    let room;

    try {
        await expect.poll(() => output).toContain('Local world ready');
        const client = new Client('http://127.0.0.1:3102', {
            headers: { Origin: 'http://127.0.0.1:3102' },
        });
        room = await client.joinById(localWorldRoomId);
        room.reconnection.enabled = false;
        expect((await room.request(initialStateRequest)).tick).toBeGreaterThanOrEqual(0);
        const disconnected = new Promise(resolve => room.onLeave(resolve));

        host.kill('SIGTERM');
        await disconnected;
        expect(await exited).toEqual({ code: 0, signal: null });
    } finally {
        room?.connection.close();

        if (host.exitCode === null) {
            host.kill('SIGKILL');
        }

        await exited;
    }
});
