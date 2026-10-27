import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:3115';
const cases = [
    {
        name: 'нож',
        equip: 'Экипировать нож',
        hits: 5,
        ticks: 6,
        range: 1.2,
        stats: 'Урон: 20 · Дальность: 1,2 м · Пауза: 0,3 с',
    },
    {
        name: 'лом',
        equip: 'Экипировать лом',
        hits: 3,
        ticks: 16,
        range: 2.2,
        stats: 'Урон: 40 · Дальность: 2,2 м · Пауза: 0,8 с',
    },
    {
        name: 'топор',
        equip: 'Экипировать топор',
        hits: 2,
        ticks: 24,
        range: 1.6,
        stats: 'Урон: 60 · Дальность: 1,6 м · Пауза: 1,2 с',
    },
];
const starter = page =>
    page
        .locator('canvas')
        .evaluate(canvas =>
            JSON.parse(canvas.dataset.zombies ?? '[]').find(
                zombie => zombie.zombieId === 'slow-zombie-1',
            ),
        );

for (const weapon of cases) {
    test(`${weapon.name} kills with its own stats and equipment survives tabs, retry and reload`, async ({
        page,
        context,
    }) => {
        test.setTimeout(30000);
        const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
            env: { ...process.env, PORT: '3115', CLIENT_ORIGIN: origin },
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
            const label = page.locator('#weapon-label');
            const attack = page.getByRole('button', { name: 'Ударить (F)' });
            await expect(status).toHaveAttribute('data-status', 'connected');
            await expect(page.locator('#weapon-options button')).toHaveCount(4);
            // Every choice updates the authoritative label and enables the other choices.
            for (const choice of cases) {
                const button = page.getByRole('button', { name: choice.equip });
                await button.click();
                await expect(label).toHaveText(`Оружие: ${choice.name}`);
                await expect(button).toHaveAttribute('aria-pressed', 'true');
                await expect(page.locator('#weapon-stats')).toHaveText(choice.stats);
            }
            if (weapon.name !== 'топор') {
                await page.getByRole('button', { name: weapon.equip }).click();
            }
            await expect(label).toHaveText(`Оружие: ${weapon.name}`);
            await expect
                .poll(async () => Math.abs((await starter(page))?.position.xMeters ?? 99), {
                    timeout: 10000,
                })
                .toBeLessThanOrEqual(weapon.range);
            for (let hit = 1; hit <= weapon.hits; hit++) {
                await attack.click();
                const tick = Number(await status.getAttribute('data-tick'));
                // Server tick is the clock; allow delivery of the command before the next swing.
                await expect
                    .poll(async () => Number(await status.getAttribute('data-tick')))
                    .toBeGreaterThanOrEqual(tick + weapon.ticks + 2);
                if (hit < weapon.hits) expect(await starter(page)).toBeDefined();
            }
            await expect.poll(() => starter(page)).toBeUndefined();
            const tab = await context.newPage();
            await tab.goto(origin);
            await expect(tab.locator('#weapon-label')).toHaveText(`Оружие: ${weapon.name}`);
            await tab.getByRole('button', { name: 'Экипировать дубинку' }).click();
            await expect(label).toHaveText('Оружие: дубинка');
            await page.getByRole('button', { name: weapon.equip }).click();
            await expect(tab.locator('#weapon-label')).toHaveText(`Оружие: ${weapon.name}`);
            await tab.close();
            await context.setOffline(true);
            await expect(status).toHaveAttribute('data-status', 'disconnected');
            await expect(page.locator('#weapon-options button:enabled')).toHaveCount(0);
            await expect(attack).toBeDisabled();
            await expect(label).toHaveText('Оружие: —');
            await expect(page.locator('#weapon-stats')).toHaveText('Характеристики: —');
            await context.setOffline(false);
            await page.getByRole('button', { name: 'Подключиться снова' }).click();
            await expect(label).toHaveText(`Оружие: ${weapon.name}`);
            await page.reload();
            await expect(label).toHaveText(`Оружие: ${weapon.name}`);
            await expect(page.locator('#weapon-stats')).toHaveText(weapon.stats);
            await expect.poll(() => starter(page)).toBeUndefined();
            await page.screenshot({
                path: `.cache/t020-weapon-${String(weapon.hits)}-hits.png`,
                fullPage: true,
            });
            expect(errors).toEqual([]);
        } finally {
            if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
            await exited;
        }
    });
}
