import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from '@playwright/test';

test('server-confirmed swings animate all weapons; refusal, switching and reconnect cannot replay them', async ({
    page,
    context,
}) => {
    const origin = 'http://127.0.0.1:3119';
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3119', CLIENT_ORIGIN: origin },
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
        await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
        await page.keyboard.press('f');
        await expect(canvas).toHaveAttribute('data-weapon-attack-tick', '-1');
        let lastTick = -1;
        for (const [weapon, label] of [
            ['club', 'дубинку'],
            ['knife', 'нож'],
            ['crowbar', 'лом'],
            ['axe', 'топор'],
        ]) {
            await page.getByRole('button', { name: `Экипировать ${label}`, exact: true }).click();
            await expect(canvas).toHaveAttribute('data-weapon', weapon);
            await page.getByRole('button', { name: 'Ударить (F)', exact: true }).click();
            await expect
                .poll(async () => Number(await canvas.getAttribute('data-weapon-attack-tick')))
                .toBeGreaterThan(lastTick);
            lastTick = Number(await canvas.getAttribute('data-weapon-attack-tick'));
            await expect(canvas).not.toHaveAttribute('data-weapon-animation', 'idle');
            if (weapon === 'axe') await canvas.screenshot({ path: '.cache/t024-axe-swing.png' });
            await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
        }
        await page.getByRole('button', { name: 'Ударить (F)', exact: true }).click();
        await expect
            .poll(async () => Number(await canvas.getAttribute('data-weapon-attack-tick')))
            .toBeGreaterThan(lastTick);
        const swingTick = await canvas.getAttribute('data-weapon-attack-tick');
        for (let index = 0; index < 5; index++) await page.keyboard.press('f');
        await expect(canvas).toHaveAttribute('data-weapon-attack-tick', swingTick);
        await page.getByRole('button', { name: 'Экипировать нож', exact: true }).click();
        await expect(canvas).toHaveAttribute('data-weapon', 'knife');
        await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
        await page.keyboard.press('f');
        await expect(canvas).toHaveAttribute('data-weapon-attack-tick', swingTick);
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(canvas).toHaveAttribute('data-weapon', 'knife');
        await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
        await expect(canvas).toHaveAttribute('data-weapon-attack-tick', '-1');
        expect(errors).toEqual([]);
    } finally {
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
