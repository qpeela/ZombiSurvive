import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:3114';
const zombies = page =>
    page.locator('canvas').evaluate(canvas => JSON.parse(canvas.dataset.zombies ?? '[]'));
const hasStarter = async page =>
    (await zombies(page)).some(zombie => zombie.zombieId === 'slow-zombie-1');

test('equip club, kill with three swings, reconnect and meet zombies in a new map area', async ({
    page,
    context,
}) => {
    test.setTimeout(40000);
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3114', CLIENT_ORIGIN: origin },
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
        const status = page.getByRole('status');
        const attack = page.getByRole('button', { name: 'Ударить (F)' });
        await expect(status).toHaveAttribute('data-status', 'connected');
        await expect(attack).toBeDisabled();
        await page.getByRole('button', { name: 'Экипировать дубинку' }).click();
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: дубинка');
        // Wait for authoritative reach rather than a guessed wall-clock pursuit delay.
        await expect
            .poll(
                async () =>
                    Math.abs(
                        (await zombies(page)).find(zombie => zombie.zombieId === 'slow-zombie-1')
                            ?.position.xMeters ?? 99,
                    ),
                { timeout: 10000 },
            )
            .toBeLessThanOrEqual(1.8);
        await attack.click();
        expect(await hasStarter(page)).toBe(true);
        const tick = Number(await status.getAttribute('data-tick'));
        await expect
            .poll(async () => Number(await status.getAttribute('data-tick')))
            .toBeGreaterThanOrEqual(tick + 13);
        await page.keyboard.press('f');
        expect(await hasStarter(page)).toBe(true);
        const secondTick = Number(await status.getAttribute('data-tick'));
        await expect
            .poll(async () => Number(await status.getAttribute('data-tick')))
            .toBeGreaterThanOrEqual(secondTick + 13);
        await attack.click();
        await expect.poll(() => hasStarter(page)).toBe(false);
        await page.screenshot({ path: '.cache/t019-melee-kill.png', fullPage: true });
        await context.setOffline(true);
        await expect(status).toHaveAttribute('data-status', 'disconnected');
        await expect(attack).toBeDisabled();
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: —');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: дубинка');
        await page.reload();
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: дубинка');
        expect(await hasStarter(page)).toBe(false);
        // North corridor crosses into the next 64 m chunk without intersecting authored ruins.
        await page.locator('canvas').scrollIntoViewIfNeeded();
        await page.keyboard.down('Shift');
        await page.keyboard.down('w');
        try {
            await expect
                .poll(async () => Number(await status.getAttribute('data-y-meters')), {
                    timeout: 15000,
                })
                .toBeLessThan(-35);
        } finally {
            await page.keyboard.up('w');
            await page.keyboard.up('Shift');
        }
        await expect
            .poll(async () =>
                (await zombies(page)).some(zombie => zombie.zombieId.startsWith('slow:0,-1:')),
            )
            .toBe(true);
        await expect.poll(async () => (await zombies(page)).length).toBeGreaterThan(1);
        await page.screenshot({ path: '.cache/t019-new-area-zombies.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally {
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
