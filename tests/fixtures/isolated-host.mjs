import { spawn } from 'node:child_process';

import { expect, test as base } from '@playwright/test';

export const isolatedHostOrigin = 'http://127.0.0.1:3129';

// A browser scenario owns both its host lifetime and save. Damage from earlier
// tests must never decide whether movement/fullscreen remains usable.
export const test = base.extend({
    isolatedHost: [
        async ({ baseURL }, use) => {
            if (baseURL !== isolatedHostOrigin) throw new Error('Isolated host needs its origin.');
            const env = { ...process.env, PORT: '3129', CLIENT_ORIGIN: isolatedHostOrigin };
            delete env.COOP_HOST;
            delete env.COOP_NETWORK;
            const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const exited = new Promise(resolve => host.once('exit', resolve));
            let output = '';
            for (const stream of [host.stdout, host.stderr])
                stream.on('data', chunk => {
                    output += chunk.toString();
                });
            try {
                await expect.poll(() => output).toContain('Local world ready');
                await use(undefined);
            } finally {
                if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
                await exited;
            }
        },
        { auto: true },
    ],
});
