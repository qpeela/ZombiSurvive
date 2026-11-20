import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from '@playwright/test';
import { combatSettings } from '@zombi-survive/content';

import { clickEquipmentAction, clickGameAction } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3132';

test('accepted swings show combat, extend it, and quiet steps clear the HUD', async ({ page }) => {
    test.setTimeout(35000);
    const host = spawn(process.execPath, ['tests/fixtures/solo-host.mjs'], {
        env: { ...process.env, PORT: '3132', CLIENT_ORIGIN: origin },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(host, 'exit');
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });

    try {
        await expect.poll(() => output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        const indicator = page.locator('#combat-status');
        const attack = page.locator('#melee-attack');
        await expect(indicator).toBeHidden();
        await clickEquipmentAction(page, 'Экипировать дубинку');
        await expect(attack).toBeEnabled();
        await clickGameAction(page, attack);
        await expect(indicator).toBeVisible();
        await expect(indicator).toHaveText('В бою');
        await expect
            .poll(async () => Number(await indicator.getAttribute('data-remaining-ticks')))
            .toBeLessThan(combatSettings.combatDurationTicks - 20);
        await clickGameAction(page, attack);
        await expect
            .poll(async () => Number(await indicator.getAttribute('data-remaining-ticks')))
            .toBeGreaterThan(combatSettings.combatDurationTicks - 20);
        await expect(indicator).toBeHidden({ timeout: 15000 });
    } finally {
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
        await exited;
    }
});
