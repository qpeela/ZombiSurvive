import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test as base } from '@playwright/test';
import { initialGroundItem } from '@zombi-survive/content';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import { openInventory } from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3121';
const test = base.extend({
    full: [false, { option: true }],
    lootHost: [
        async ({ full }, use) => {
            const directory = mkdtempSync(join(tmpdir(), 'zombi-loot-drag-'));
            const path = join(directory, 'world.sqlite');
            const store = new SoloWorldStore(path);
            store.savePosition(initialGroundItem.position, 14 * 3_600_000);
            if (full) {
                const { playerId } = store.initialWorld;
                let slot = 0;
                const packIds = new Set(['ammo9mm-v1:0:0', 'scatter-v1:pistol:west:ammo']);
                store.saveItemLocations(
                    store.initialItemLocations.map(location => {
                        const { item } = location;
                        if (
                            location.type !== 'container' &&
                            !(item.kind === 'ammo9mm' && packIds.has(item.itemId))
                        )
                            return location;

                        const cell = { column: 1 + (slot % 2), row: Math.floor(slot / 2) };
                        slot++;

                        return {
                            type: 'container',
                            playerId,
                            item:
                                item.kind === 'ammo9mm'
                                    ? { kind: 'ammo9mm', itemId: item.itemId, quantity: 1 }
                                    : item,
                            cell,
                        };
                    }),
                );
            }
            store.close();

            const env = {
                ...process.env,
                PORT: '3121',
                CLIENT_ORIGIN: origin,
                WORLD_SAVE_PATH: path,
            };
            delete env.COOP_HOST;
            delete env.COOP_NETWORK;
            const host = spawn(process.execPath, ['apps/server/dist/main.js'], {
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let output = '';
            for (const stream of [host.stdout, host.stderr])
                stream.on('data', chunk => {
                    output += chunk.toString();
                });
            const exited = new Promise(resolve => host.once('exit', resolve));
            try {
                await expect.poll(() => output).toContain('Local world ready');
                await use(undefined);
            } finally {
                if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
                await exited;
                rmSync(directory, { recursive: true, force: true });
            }
        },
        { auto: true },
    ],
});

const open = async page => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await openInventory(page);
    const source = page.locator('[data-loot-drag-id="starter-bandage"]');
    const zone = page.locator('#loot-drop-zone');
    const take = page.getByRole('button', { name: 'Взять: Бинт', exact: true });
    const inventoryItem = page.locator('#inventory-select[data-item-id="starter-bandage"]');
    const status = page.locator('#loot-drop-status');
    await expect(source).toBeVisible();
    await source.scrollIntoViewIfNeeded();
    await expect(zone).toBeInViewport();

    return { source, zone, take, inventoryItem, status };
};

test('a loot drop uses host placement and ignores repeated drop and button input', async ({
    page,
}) => {
    let pickups = 0;
    page.on('websocket', socket => {
        socket.on('framesent', ({ payload }) => {
            if (payload.includes('pickup-item')) pickups++;
        });
    });
    const { source, zone, take, inventoryItem, status } = await open(page);
    await expect(take).toBeEnabled();
    await expect(inventoryItem).toHaveCount(0);

    // Send the duplicate inputs in the same browser task as the native drop.
    await zone.evaluate(dropZone => {
        const document = dropZone.ownerDocument;
        document.addEventListener(
            'drop',
            event => {
                dropZone.dispatchEvent(
                    new document.defaultView.DragEvent('drop', {
                        bubbles: true,
                        dataTransfer: event.dataTransfer,
                    }),
                );
                document.querySelector('#pickup').click();
            },
            { once: true },
        );
    });
    await source.dragTo(zone);
    await expect(status).toHaveText('Предмет в рюкзаке.');
    await expect(inventoryItem).toHaveCount(1);
    await expect(source).toHaveCount(0);
    expect(pickups).toBe(1);
});

test('the Take button remains a keyboard alternative to dragging', async ({ page }) => {
    const { take, inventoryItem } = await open(page);
    await take.focus();
    await page.keyboard.press('Enter');
    await expect(inventoryItem).toHaveCount(1);
    await expect(take).toHaveCount(0);
});

test.describe('full backpack', () => {
    test.use({ full: true });

    test('a native drag into a full backpack explains why the item stayed nearby', async ({
        page,
    }) => {
        const { source, zone, take, inventoryItem, status } = await open(page);
        await expect(take).toBeDisabled();
        await source.dragTo(zone);
        await expect(status).toHaveText('В сетке нет места или превышена допустимая масса.');
        await expect(inventoryItem).toHaveCount(0);
        await expect(source).toBeVisible();
    });
});
