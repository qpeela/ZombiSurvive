import { createInterface } from 'node:readline';

import { startLocalServer } from '../../apps/server/dist/local-server.js';
import { LocalWorldRoom } from '../../apps/server/dist/local-world-room.js';
import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

// Existing clock/RNG inputs make expiry and the 25% wound roll reproducible.
// Simulation, sockets and UI run normally; global Date.now is untouched.
const path = process.env.WORLD_SAVE_PATH;
if (!path) throw new Error('Acceptance host requires an explicit disposable WORLD_SAVE_PATH.');
let offsetMs = Number(process.env.SOLO_ACCEPTANCE_CLOCK_OFFSET_MS ?? 0);
const maximumOffsetMs = 7 * 24 * 60 * 60 * 1000;
if (!Number.isSafeInteger(offsetMs) || offsetMs < 0 || offsetMs > maximumOffsetMs)
    throw new Error('Invalid acceptance clock offset.');
const now = () => Date.now() + offsetMs;
let randomState = 1;
const roll = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
};
const originalOnCreate = LocalWorldRoom.prototype.onCreate;
LocalWorldRoom.prototype.onCreate = function (options) {
    // LocalWorldCombat captures its default RNG during synchronous onCreate.
    // Restore immediately: transport/auth never use the acceptance stream.
    const originalRandom = Math.random;
    try {
        Math.random = roll;
        return originalOnCreate.call(this, { ...options, now });
    } finally {
        Math.random = originalRandom;
    }
};
const store = new SoloWorldStore(path, now);
const port = Number(process.env.SOLO_ACCEPTANCE_PORT ?? 3136);
if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid acceptance host port.');
const origin = `http://127.0.0.1:${String(port)}`;
const server = await startLocalServer(
    port,
    origin,
    new URL('../../apps/client/dist/', import.meta.url),
    { soloStore: store },
).catch(error => {
    store.close();
    throw error;
});
const input = createInterface({ input: process.stdin });
const advanceClock = command => {
    const deltaMs = command?.advanceMs;
    if (!Number.isSafeInteger(deltaMs) || deltaMs <= 0 || offsetMs + deltaMs > maximumOffsetMs)
        throw new Error('Clock advance must be positive and bounded to seven days.');
    offsetMs += deltaMs;
    const acknowledgement = { type: 'clock-advanced', offsetMs };
    process.stdout.write(`${JSON.stringify(acknowledgement)}\n`);
    process.send?.(acknowledgement);
};
const onError = error => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
    return server.gracefullyShutdown(false);
};
input.on('line', line => {
    try {
        advanceClock(JSON.parse(line));
    } catch (error) {
        onError(error).catch(error => process.stderr.write(`${String(error)}\n`));
    }
});
process.on('message', command => {
    try {
        advanceClock(command);
    } catch (error) {
        onError(error).catch(error => process.stderr.write(`${String(error)}\n`));
    }
});
server.onShutdown(() => {
    // Colyseus replaces (rather than adds) its shutdown callback.
    store.close();
    input.close();
    process.stdin.pause();
    if (process.connected) process.disconnect();
});
let isStopping = false;
const shutdown = () => {
    if (isStopping) return;
    isStopping = true;
    server.gracefullyShutdown(false).catch(error => {
        process.stderr.write(`${String(error)}\n`);
        process.exitCode = 1;
    });
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.stdout.write(`Local world ready at ${origin}/ (acceptance clock ${offsetMs})\n`);
