import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { combatSettings } from '@zombi-survive/content';
import { isHealthSnapshot, localWorldRoomId } from '@zombi-survive/protocol';

const origin = 'http://127.0.0.1:3113';
test('server attacks reduce shared health on fixed ticks; zero, movement and reconnect work in Chromium', async ({
    page,
    context,
}) => {
    test.setTimeout(40000);
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3113', CLIENT_ORIGIN: origin },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(host, 'exit');
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const errors = [];
    const healthSamples = [];
    page.on('pageerror', error => errors.push(error.message));
    let observer;
    try {
        await expect.poll(() => output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        const health = page.getByRole('progressbar', { name: 'Здоровье:' });
        await expect(health).toHaveJSProperty('value', 100);
        const client = new Client(origin, { headers: { Origin: origin } });
        observer = await client.joinById(localWorldRoomId);
        observer.onMessage('movement-snapshot', () => {});
        observer.onMessage('pickup-state', () => {});
        observer.onMessage('zombie-state', () => {});
        observer.onMessage('health-state', snapshot => healthSamples.push(snapshot));
        await expect
            .poll(async () => Number(await health.getAttribute('value')), { timeout: 10000 })
            .toBeLessThan(100);
        await expect(page.locator('#health-label')).toHaveText(/Здоровье: \d+ \/ 100/);
        await page.screenshot({ path: '.cache/t018-zombie-damage.png', fullPage: true });
        await expect(health).toHaveJSProperty('value', 0, { timeout: 16000 });
        const hits = healthSamples.filter(
            (sample, index) => index > 0 && sample.health < healthSamples[index - 1].health,
        );
        expect(hits.length).toBeGreaterThanOrEqual(9);
        for (const sample of healthSamples) expect(isHealthSnapshot(sample)).toBe(true);
        for (let index = 1; index < hits.length; index++) {
            expect(hits[index].tick - hits[index - 1].tick).toBe(
                combatSettings.attackIntervalTicks,
            );
            expect(hits[index - 1].health - hits[index].health).toBe(combatSettings.zombieDamage);
        }
        // Zero health has no death/respawn mechanic yet; ordinary movement still works.
        await page.locator('canvas').scrollIntoViewIfNeeded();
        await page.keyboard.down('d');
        try {
            await expect
                .poll(async () =>
                    Number(await page.getByRole('status').getAttribute('data-x-meters')),
                )
                .toBeGreaterThan(1);
        } finally {
            await page.keyboard.up('d');
        }
        await expect(health).toHaveJSProperty('value', 0);
        observer.connection.close();
        observer = undefined;
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect(page.locator('#health-label')).toHaveText('Здоровье: —');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(page.locator('#health-label')).toHaveText('Здоровье: 0 / 100');
        await page.reload();
        await expect(page.locator('#health-label')).toHaveText('Здоровье: 0 / 100');
        await page.screenshot({ path: '.cache/t018-health-reloaded.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally {
        observer?.connection.close();
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
