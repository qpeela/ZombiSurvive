import { spawn } from 'node:child_process';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

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
