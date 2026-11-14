import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from '@playwright/test';

import { activateStartingZombie, distanceToStartingZombie } from '../fixtures/game-controls.mjs';

const character = page =>
    page.locator('canvas').evaluate(canvas => JSON.parse(canvas.dataset.playerCharacter ?? 'null'));
const zombie = page =>
    page
        .locator('canvas')
        .evaluate(canvas =>
            JSON.parse(canvas.dataset.zombieCharacters ?? '[]').find(
                actor => actor.id === 'slow-zombie-1',
            ),
        );
const assertGrip = async page => {
    await expect
        .poll(() =>
            page.locator('canvas').evaluate(canvas => {
                const actor = JSON.parse(canvas.dataset.playerCharacter ?? 'null');
                if (actor?.hand === null || actor?.hand === undefined) return Infinity;
                const angle = Number(canvas.dataset.weaponAngle);
                const x =
                    Number(canvas.dataset.weaponX) + Math.cos(angle) * 10 - Math.sin(angle) * 6;
                const y =
                    Number(canvas.dataset.weaponY) + Math.sin(angle) * 10 + Math.cos(angle) * 6;
                return Math.hypot(actor.hand.x - x, actor.hand.y - y);
            }),
        )
        .toBeLessThan(0.001);
};
const settle = async page => {
    await expect.poll(async () => (await character(page))?.mode).toBe('idle');
    await expect
        .poll(async () => Math.abs((await character(page))?.leftStep ?? Infinity))
        .toBeLessThan(0.02);
};

test('articulated figures walk, crouch, run, hold weapons and shuffle; removal and reconnect reset their pose', async ({
    page,
    context,
}) => {
    const origin = 'http://127.0.0.1:3139';
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3139', CLIENT_ORIGIN: origin },
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
        await expect.poll(async () => (await character(page))?.kind).toBe('player');
        await settle(page);
        await canvas.screenshot({ path: '.cache/t041-idle.png' });
        await page.getByRole('button', { name: 'Экипировать топор', exact: true }).click();
        await expect(canvas).toHaveAttribute('data-weapon', 'axe');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        if (box === null) throw new Error('Game canvas is not visible.');
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
        await assertGrip(page);

        await page.keyboard.down('d');
        try {
            await expect.poll(async () => (await character(page))?.mode).toBe('walk');
            await expect
                .poll(async () => Math.abs((await character(page))?.leftStep ?? 0))
                .toBeGreaterThan(0.3);
            await expect
                .poll(async () =>
                    Number(await page.getByRole('status').getAttribute('data-x-meters')),
                )
                .toBeGreaterThan(2);
            await canvas.screenshot({ path: '.cache/t041-walk.png' });
        } finally {
            await page.keyboard.up('d');
        }
        await settle(page);

        await page.keyboard.down('Control');
        await page.keyboard.down('a');
        try {
            await expect.poll(async () => (await character(page))?.mode).toBe('sneak');
            await assertGrip(page);
            await expect
                .poll(async () =>
                    Number(await page.getByRole('status').getAttribute('data-x-meters')),
                )
                .toBeLessThan(1);
            await canvas.screenshot({ path: '.cache/t041-sneak.png' });
        } finally {
            await page.keyboard.up('a');
            await page.keyboard.up('Control');
        }
        await settle(page);
        await page.keyboard.down('Shift');
        await page.keyboard.down('w');
        try {
            await expect.poll(async () => (await character(page))?.mode).toBe('run');
            await expect
                .poll(async () =>
                    Number(await page.getByRole('status').getAttribute('data-y-meters')),
                )
                .toBeLessThan(-2);
        } finally {
            await page.keyboard.up('w');
            await page.keyboard.up('Shift');
        }
        await settle(page);
        await activateStartingZombie(page);
        await expect.poll(async () => (await zombie(page))?.mode).toBe('shuffle');
        await expect
            .poll(async () => Math.abs((await zombie(page))?.leftStep ?? 0))
            .toBeGreaterThan(0.3);
        await canvas.screenshot({ path: '.cache/t041-pursuit.png' });
        await expect
            .poll(() => distanceToStartingZombie(page), { timeout: 10000 })
            .toBeLessThanOrEqual(1.6);
        const attack = page.getByRole('button', { name: 'Ударить (F)', exact: true });
        await attack.click();
        await expect(canvas).not.toHaveAttribute('data-weapon-animation', 'idle');
        await assertGrip(page);
        await canvas.screenshot({ path: '.cache/t041-swing.png' });
        await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
        await attack.click();
        await expect.poll(async () => (await zombie(page)) === undefined).toBe(true);
        await context.setOffline(true);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect.poll(() => character(page)).toBeNull();
        await expect(canvas).toHaveAttribute('data-zombie-characters', '[]');
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(canvas).toHaveAttribute('data-weapon', 'axe');
        await settle(page);
        await assertGrip(page);
        await page.reload();
        await expect(page.locator('canvas')).toHaveCount(1);
        await settle(page);
        await expect(canvas).toHaveAttribute('data-weapon-animation', 'idle');
        await assertGrip(page);
        await canvas.screenshot({ path: '.cache/t041-restored.png' });
        expect(errors).toEqual([]);
    } finally {
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
