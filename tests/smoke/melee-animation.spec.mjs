import { fork } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from '@playwright/test';
import { meleeWeapons } from '@zombi-survive/content';

import { clickEquipmentAction } from '../fixtures/game-panels.mjs';

test('server-confirmed swings animate all weapons; refusal, switching and reconnect cannot replay them', async ({
    page,
    context,
}) => {
    const origin = 'http://127.0.0.1:3119';
    const host = fork('tests/fixtures/melee-animation-host.mjs', {
        env: { ...process.env, PORT: '3119', CLIENT_ORIGIN: origin },
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const exited = once(host, 'exit');
    let isArmed = false;
    host.on('message', message => {
        if (message?.type === 'manual-melee-ticks-armed') isArmed = true;
    });
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
            await clickEquipmentAction(page, `Экипировать ${label}`);
            await expect(canvas).toHaveAttribute('data-weapon', weapon);
            await page.getByRole('button', { name: 'Ударить (F)', exact: true }).click();
            await expect
                .poll(async () => Number(await canvas.getAttribute('data-weapon-attack-tick')))
                .toBeGreaterThan(lastTick);
            lastTick = Number(await canvas.getAttribute('data-weapon-attack-tick'));
            await expect(canvas).not.toHaveAttribute('data-weapon-animation', 'idle');
            if (weapon === 'axe') await canvas.screenshot({ path: '.cache/t024-axe-swing.png' });
            // A local animation can finish before a busy host has advanced its cooldown.
            // Pause that host for the axe to exercise both clocks independently.
            if (weapon === 'axe') host.kill('SIGSTOP');
            try {
                await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
            } finally {
                if (weapon === 'axe') host.kill('SIGCONT');
            }
            await expect
                .poll(async () => Number(await page.getByRole('status').getAttribute('data-tick')))
                .toBeGreaterThanOrEqual(lastTick + meleeWeapons[weapon].cooldownTicks);
        }
        host.send({ type: 'arm-manual-melee-ticks' });
        await expect.poll(() => isArmed).toBe(true);
        await page.getByRole('button', { name: 'Ударить (F)', exact: true }).click();
        await expect
            .poll(async () => Number(await canvas.getAttribute('data-weapon-attack-tick')))
            .toBeGreaterThan(lastTick);
        const swingTick = await canvas.getAttribute('data-weapon-attack-tick');
        const tick = async () => Number(await page.getByRole('status').getAttribute('data-tick'));
        const attackDuringCooldown = async () => {
            const before = await tick();
            await page.keyboard.press('f');
            await expect.poll(tick).toBeGreaterThan(before);
            expect(await tick()).toBeLessThan(Number(swingTick) + meleeWeapons.axe.cooldownTicks);
            await expect(canvas).toHaveAttribute('data-weapon-attack-tick', swingTick);
        };
        for (let index = 0; index < 5; index++) await attackDuringCooldown();
        await clickEquipmentAction(page, 'Экипировать нож');
        await expect(canvas).toHaveAttribute('data-weapon', 'knife');
        await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
        await attackDuringCooldown();
        host.send({ type: 'resume-ticks' });
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
        if (host.connected) host.disconnect();
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
