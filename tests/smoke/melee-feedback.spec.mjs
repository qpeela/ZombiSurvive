import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from '@playwright/test';

const effects = page =>
    page.locator('canvas').evaluate(canvas => JSON.parse(canvas.dataset.meleeEffects ?? '[]'));
const outcome = (page, expected) =>
    expect.poll(async () => (await effects(page)).at(-1)?.impact).toMatchObject(expected);

test('confirmed miss, damage and kill are distinct, expire and clear on disconnect', async ({
    page,
    context,
}) => {
    const origin = 'http://127.0.0.1:3120';
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3120', CLIENT_ORIGIN: origin },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(host, 'exit');
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(() => output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        const canvas = page.locator('canvas');
        const attack = page.getByRole('button', { name: 'Ударить (F)', exact: true });
        await page.getByRole('button', { name: 'Экипировать дубинку', exact: true }).click();
        await expect(canvas).toHaveAttribute('data-weapon', 'club');
        await attack.click();
        await expect
            .poll(async () => (await effects(page)).at(-1)?.impact)
            .toEqual({ outcome: 'miss', position: { xMeters: 0, yMeters: 0 } });
        await canvas.screenshot({ path: '.cache/t025-miss.png' });
        await expect.poll(() => effects(page)).toEqual([]);
        await expect
            .poll(
                async () => {
                    const zombies = await canvas.evaluate(element =>
                        JSON.parse(element.dataset.zombies ?? '[]'),
                    );
                    const zombie = zombies.find(state => state.zombieId === 'slow-zombie-1');
                    return zombie === undefined
                        ? 99
                        : Math.hypot(zombie.position.xMeters, zombie.position.yMeters);
                },
                { timeout: 10000 },
            )
            .toBeLessThanOrEqual(1.8);
        for (let index = 0; index < 3; index++) {
            await attack.click();
            await outcome(page, {
                outcome: index === 2 ? 'kill' : 'hit',
                zombieId: 'slow-zombie-1',
                damage: index === 2 ? 32 : 34,
            });
            if (index === 2) await canvas.screenshot({ path: '.cache/t025-kill.png' });
            await expect.poll(() => effects(page)).toEqual([]);
        }
        // A new miss creates an effect which must disappear on connection loss.
        await attack.click();
        await outcome(page, { outcome: 'miss' });
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect.poll(() => effects(page)).toEqual([]);
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(canvas).toHaveAttribute('data-weapon', 'club');
        await expect.poll(() => effects(page)).toEqual([]);
        await page.reload();
        await expect(canvas).toHaveAttribute('data-weapon', 'club');
        await expect.poll(() => effects(page)).toEqual([]);
        expect(errors).toEqual([]);
    } finally {
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
