import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import {
    firearmVersion,
    localWorldRoomId,
    meleeVersion,
    protocolVersion,
} from '@zombi-survive/protocol';

import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';
import {
    clickEquipmentAction,
    clickGameAction,
    openEquipment,
    openInventory,
} from '../fixtures/game-panels.mjs';

const origin = 'http://127.0.0.1:3134';
const start = path => {
    const env = { ...process.env, PORT: '3134', CLIENT_ORIGIN: origin, WORLD_SAVE_PATH: path };
    delete env.COOP_HOST;
    delete env.COOP_NETWORK;
    const host = spawn(process.execPath, [resolve('apps/server/dist/main.js')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [host.stdout, host.stderr])
        stream.on('data', chunk => {
            output += chunk.toString();
        });
    const exited = new Promise(resolve => host.once('exit', resolve));
    return { host, exited, output: () => output };
};
const stop = async (running, signal = 'SIGTERM') => {
    if (running.host.exitCode === null && running.host.signalCode === null)
        running.host.kill(signal);
    const kill = setTimeout(() => running.host.kill('SIGKILL'), 4000);
    try {
        await running.exited;
    } finally {
        clearTimeout(kill);
    }
};
const seed = (path, rounds = 3, quantity = 8, hasExtraReserve = false) => {
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    let itemId;
    const locations = store.initialItemLocations.map(location => {
        if (location.item.itemId === 'pistol-v1:0:0') {
            itemId = location.item.itemId;
            return {
                type: 'hands',
                playerId,
                item: { itemId, kind: 'pistol', rounds, magazineCapacity: 8 },
            };
        }
        if (location.item.itemId === 'ammo9mm-v1:0:0')
            return {
                type: 'container',
                playerId,
                item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity },
                cell: { column: 0, row: 0 },
            };
        if (hasExtraReserve && location.item.itemId === 'scatter-v1:pistol:west:ammo')
            return {
                type: 'container',
                playerId,
                item: { itemId: location.item.itemId, kind: 'ammo9mm', quantity: 2 },
                cell: { column: 1, row: 0 },
            };
        if (hasExtraReserve && location.item.itemId === `${playerId}:axe`)
            return { type: 'expired', item: location.item };
        return location;
    });
    store.saveItemLocations(locations);
    store.savePosition({ xMeters: 8, yMeters: 12 });
    store.close();
    return itemId;
};
const pack = page => page.locator('#inventory-items button[data-item-id="ammo9mm-v1:0:0"]');
const firstPistolId = 'pistol-v1:0:0';
const secondPistolId = 'scatter-v1:pistol:west';
const seedContextInventory = (path, { bleedingTicks = 0, isPacked = false } = {}) => {
    const store = new SoloWorldStore(path);
    const { playerId } = store.initialWorld;
    const locations = store.initialItemLocations.map(location => {
        const { item } = location;
        if (item.itemId === 'starter-bandage')
            return {
                type: 'container',
                playerId,
                item: { itemId: item.itemId, kind: 'bandage' },
                cell: { column: 0, row: isPacked ? 0 : 2 },
            };
        if (item.itemId === firstPistolId || item.itemId === secondPistolId) {
            const isFirst = item.itemId === firstPistolId;
            const normalCell = { column: isFirst ? 0 : 2, row: 0 };
            const packedCell = isFirst ? { column: 2, row: 0 } : { column: 1, row: 1 };

            return {
                type: 'container',
                playerId,
                item: {
                    itemId: item.itemId,
                    kind: 'pistol',
                    magazineCapacity: 8,
                    rounds: isFirst ? 1 : 5,
                },
                cell: isPacked ? packedCell : normalCell,
            };
        }

        const packIds = ['ammo9mm-v1:0:0', 'scatter-v1:pistol:west:ammo'];
        const packIndex = packIds.indexOf(item.itemId);
        if (isPacked && item.kind === 'ammo9mm' && packIndex >= 0) {
            return {
                type: 'container',
                playerId,
                item: { itemId: item.itemId, kind: item.kind, quantity: 1 },
                cell: { column: packIndex + 1, row: 2 },
            };
        }

        return location.type === 'container' ? { type: 'expired', item } : location;
    });
    store.saveCombat({ health: 70, cooldownTicks: 0, bleedingTicks }, locations, {
        xMeters: 8,
        yMeters: 12,
    });
    store.close();
};
const connect = async () => {
    const room = await new Client(origin, { headers: { Origin: origin } }).joinById(
        localWorldRoomId,
    );
    room.reconnection.enabled = false;
    for (const type of [
        'movement-snapshot',
        'pickup-state',
        'zombie-state',
        'health-state',
        'melee-state',
        'profile-state',
        'melee-action',
        'shot-action',
        'firearm-state',
    ])
        room.onMessage(type, () => {});
    return room;
};
const request = (type, itemId, weaponRevision = 0) => ({
    type,
    protocolVersion,
    firearmVersion,
    itemId,
    weaponRevision,
    ...(type === 'shoot-pistol' ? { aim: { x: 1, y: 0 } } : {}),
});

test('item context actions use the exact pistol, support the context key and dismiss on removal or Escape', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-item-context-'));
    const path = join(directory, 'world.sqlite');
    let running;
    let room;
    try {
        seedContextInventory(path);
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await openInventory(page);
        const inventory = page.locator('#inventory-panel');
        const cell = name => inventory.getByRole('button', { name, exact: true });
        const menu = inventory.getByRole('menu');
        const equip = menu.getByRole('menuitem', { name: 'Взять в руки', exact: true });
        const first = cell('Ячейка 1, 1');
        const second = cell('Ячейка 3, 1');

        await expect(second).toHaveAttribute('data-item-id', secondPistolId);
        await second.click({ button: 'right' });
        await expect(menu).toHaveAccessibleName('Пистолет 9 мм · ячейка 3, 1');
        await expect(equip).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: 'Переместить' })).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(equip).toBeFocused();
        await page.screenshot({ path: '.cache/t071-item-context.png' });
        await equip.click();
        await expect(page.locator('#held-ammo')).toHaveText('Магазин: 5/8 · Запас: 0');

        await first.focus();
        await page.keyboard.press('Shift+F10');
        await expect(menu).toHaveAccessibleName('Пистолет 9 мм · ячейка 1, 1');
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(inventory).toBeVisible();
        await expect(first).toBeFocused();
        await page.keyboard.press('Shift+F10');
        await expect(menu).toBeVisible();
        room = await connect();
        room.onMessage('pickup-state', () => {});
        room.send('equip-weapon', {
            type: 'equip-weapon',
            protocolVersion,
            meleeVersion,
            itemId: firstPistolId,
        });
        await expect(page.locator('#held-ammo')).toHaveText('Магазин: 1/8 · Запас: 0');
        await expect(menu).toBeHidden();
        await expect(inventory).toBeFocused();

        await cell('Ячейка 1, 3').click({ button: 'right' });
        const bandage = menu.getByRole('menuitem', { name: 'Перевязаться', exact: true });
        await expect(bandage).toBeDisabled();
        await expect(bandage).toHaveAccessibleDescription('Кровотечения нет.');
        await page.keyboard.press('Enter');
        await expect(menu).toBeVisible();
        await expect(cell('Ячейка 1, 3')).toHaveAttribute('data-item-id', 'starter-bandage');
    } finally {
        room?.connection.close();
        if (running !== undefined) await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('the bandage context action consumes the item after the host stops bleeding', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-context-bandage-'));
    const path = join(directory, 'world.sqlite');
    let running;
    try {
        seedContextInventory(path, { bleedingTicks: 100, isPacked: true });
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        const bleeding = page.locator('#bleeding-label');
        await expect(bleeding).toHaveAttribute('data-bleeding', 'true');
        await openInventory(page);
        const cell = page.getByRole('button', { name: 'Ячейка 1, 1', exact: true });
        await expect(cell).toHaveAttribute('data-item-id', 'starter-bandage');
        await cell.click({ button: 'right' });
        const move = page.getByRole('menuitem', { name: 'Переместить', exact: true });
        await expect(move).toBeDisabled();
        await expect(move).toHaveAccessibleDescription('Нет свободной позиции для предмета.');
        const bandage = page.getByRole('menuitem', { name: 'Перевязаться', exact: true });
        await expect(bandage).toBeEnabled();
        await bandage.click();
        await expect(bleeding).toHaveAttribute('data-bleeding', 'false');
        await expect(cell).toHaveAttribute('data-occupied', 'false');
    } finally {
        if (running !== undefined) await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('inventory details follow each instance on hover and focus and clear when equipped', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-item-details-'));
    const path = join(directory, 'world.sqlite');
    let running;
    try {
        seed(path, 0, 6, true);
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.setViewportSize({ width: 1280, height: 600 });
        await page.goto(origin);
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
        await clickEquipmentAction(page, 'Убрать оружие в сетку');
        await openInventory(page);
        const inventory = page.locator('#inventory-panel');
        const details = inventory.locator('#item-details');
        const first = pack(page);
        const second = inventory.locator(
            '#inventory-items button[data-item-id="scatter-v1:pistol:west:ammo"]',
        );
        const pistol = inventory.getByRole('button', { name: /^Переместить: Пистолет/ });

        await first.hover();
        await expect(details.locator('strong')).toHaveText('Патроны 9 мм');
        await expect(details).toContainText('72 г · 1 × 1 · Количество: 6');
        await second.focus();
        await expect(details).toContainText('24 г · 1 × 1 · Количество: 2');
        await pistol.focus();
        await expect(details.locator('strong')).toHaveText('Пистолет 9 мм');
        await expect(details).toContainText('800 г · 2 × 1 · Магазин: 0/8');
        await expect(details).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: '.cache/t067-item-details.png' });
        await page.locator('#toggle-inventory').hover();

        const other = await context.newPage();
        try {
            await other.goto(origin);
            await clickEquipmentAction(other, 'Экипировать пистолет');
            await expect(page.locator('#held-item')).toHaveText('В руках: Пистолет 9 мм');
            await expect(pistol).toHaveCount(0);
            await expect(details).toBeHidden();
            await expect(inventory).toBeFocused();
        } finally {
            await other.close();
        }
    } finally {
        if (running !== undefined) await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('the persistent strip separates an empty magazine from reserve, changes weapon and clears on reconnect', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-held-hud-'));
    const path = join(directory, 'world.sqlite');
    let running;
    try {
        seed(path, 0, 6, true);
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        const equipment = page.getByRole('group', { name: 'Экипировка в руках' });
        const weapon = equipment.locator('#held-item');
        const ammo = equipment.locator('#held-ammo');
        const panel = page.locator('#equipment-panel');
        await expect(panel).toBeHidden();
        await expect(weapon).toHaveText('В руках: Пистолет 9 мм');
        await expect(ammo).toHaveText('Магазин: 0/8 · Запас: 8');
        await expect(ammo).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: '.cache/t066-empty-magazine.png' });

        const viewport = page.viewportSize();
        await page.setViewportSize({ width: 400, height: 300 });
        await page.locator('#world-hud summary').click();
        await expect(ammo).toBeInViewport({ ratio: 1 });
        const topHud = await page.locator('.stamina-hud').boundingBox();
        const bottomHud = await equipment.boundingBox();
        expect(topHud.y + topHud.height).toBeLessThanOrEqual(bottomHud.y);
        await page.screenshot({ path: '.cache/t066-compact.png' });
        await page.locator('#world-hud summary').click();
        await page.setViewportSize(viewport);
        await context.setOffline(true);
        await expect(weapon).toHaveText('В руках: —');
        await expect(ammo).toBeHidden();
        await context.setOffline(false);
        await page.getByRole('button', { name: 'Подключиться снова' }).click();
        await expect(weapon).toHaveText('В руках: Пистолет 9 мм');
        await expect(ammo).toHaveText('Магазин: 0/8 · Запас: 8');
        await expect(ammo).toBeVisible();
        await clickEquipmentAction(page, 'Экипировать лом');
        await expect(weapon).toHaveText('В руках: Лом');
        await expect(ammo).toBeHidden();
        await expect(page.locator('#unequip-weapon')).toBeEnabled();
        await clickEquipmentAction(page, 'Убрать оружие в сетку');
        await expect(weapon).toHaveText('В руках: пусто');
        await expect(equipment.locator('..')).toHaveCSS('position', 'absolute');
        await expect(ammo).toBeHidden();
    } finally {
        if (running !== undefined) await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('R and HUD reload share progress across tabs, block shots, retain pack quantity and cancel on weapon replacement', async ({
    page,
    context,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-reload-ui-'));
    const path = join(directory, 'world.sqlite');
    seed(path);
    const running = start(path);
    let tab;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(page.locator('#held-ammo')).toHaveText('Магазин: 3/8 · Запас: 8');
        await expect(pack(page)).toContainText('×8');
        await expect(pack(page)).toContainText('96 г');
        tab = await context.newPage();
        await tab.goto(origin);
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await page.bringToFront();
        await page.keyboard.down('r');
        const progress = page.getByRole('progressbar', { name: 'Перезарядка' });
        await expect(progress).toBeInViewport();
        await expect(tab.getByRole('progressbar', { name: 'Перезарядка' })).toBeInViewport();
        const firstProgress = await progress.evaluate(meter => meter.value);
        await expect
            .poll(() => progress.evaluate(meter => meter.value))
            .toBeGreaterThan(firstProgress);
        await expect(progress).toHaveAttribute('max', '40');
        await expect(page.locator('#held-ammo')).toHaveText('Магазин: 3/8 · Запас: 8');
        await expect(page.locator('#pistol-shot')).toBeDisabled();
        await expect(page.locator('#pistol-reload')).toBeDisabled();
        await page.keyboard.down('r');
        await page.keyboard.up('r');
        await page.keyboard.press('Space');
        await page.locator('canvas').click({ button: 'right', position: { x: 600, y: 260 } });
        await page.screenshot({ path: '.cache/t038-reloading.png', fullPage: true });
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(progress).toBeHidden();
        await expect(page.locator('#held-ammo')).toHaveText('Магазин: 8/8 · Запас: 3');
        await expect(tab.locator('#held-ammo')).toHaveText('Магазин: 8/8 · Запас: 3');
        await expect(pack(page)).toContainText('×3');
        await expect(pack(page)).toContainText('36 г');
        await expect(page.locator('#pistol-reload')).toBeDisabled();
        await clickGameAction(page, page.locator('#pistol-shot'));
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await expect(page.locator('#held-ammo')).toHaveText('Магазин: 7/8 · Запас: 3');
        await openEquipment(page);
        await clickGameAction(page, page.locator('#pistol-reload'));
        await expect(page.locator('#reload-progress')).toBeVisible();
        await clickEquipmentAction(page, 'Экипировать топор');
        await expect(page.locator('#weapon-label')).toHaveText('Оружие: топор');
        await expect(page.locator('#reload-progress')).toBeHidden();
        await clickEquipmentAction(page, 'Экипировать пистолет');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 7/8');
        await expect(pack(page)).toContainText('×3');
        await clickGameAction(page, page.locator('#pistol-reload'));
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(pack(page)).toContainText('×2');
        await expect(tab.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 8/8');
        await expect(pack(page)).toContainText('×2');
        expect(errors).toEqual([]);
    } finally {
        await tab?.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('SIGKILL during progress cancels without spending; a short pack then fills only available rounds and never respawns', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-reload-cancel-'));
    const path = join(directory, 'world.sqlite');
    seed(path, 0, 3);
    let running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await clickGameAction(page, page.locator('#pistol-reload'));
        await expect(page.locator('#reload-progress')).toBeVisible();
        await stop(running, 'SIGKILL');
        await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
        await expect(page.locator('#held-reload')).toBeHidden();
        await expect(page.locator('#held-ammo')).toBeHidden();
        const cancelled = new SoloWorldStore(path);
        expect(
            cancelled.initialItemLocations.find(
                location =>
                    location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
            ),
        ).toMatchObject({ item: { rounds: 0 } });
        expect(
            cancelled.initialItemLocations.find(
                location =>
                    location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
            ),
        ).toMatchObject({ type: 'container', item: { quantity: 3 } });
        cancelled.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await expect(page.locator('#reload-progress')).toBeHidden();
        await page.keyboard.press('r');
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(page.locator('#held-ammo')).toHaveText('Магазин: 3/8 · Запас: 0');
        await expect(page.locator('#held-ammo')).toBeVisible();
        await expect(pack(page)).toHaveCount(0);
        await expect(page.locator('#pistol-reload')).toBeDisabled();
        await page.screenshot({ path: '.cache/t038-partial-pack.png', fullPage: true });
        await stop(running, 'SIGKILL');
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(pack(page)).toHaveCount(0);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('first reload completion ack survives SIGKILL; stale retry cannot consume the remaining pack after a shot', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-reload-commit-'));
    const path = join(directory, 'world.sqlite');
    const itemId = seed(path);
    let running = start(path);
    let room;
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        let state;
        const committingHost = running.host;
        room.onMessage('pickup-state', value => {
            state = value;
            if (value.hands?.rounds === 8 && value.hands.revision === 1)
                committingHost.kill('SIGKILL');
        });
        await expect.poll(() => state?.hands?.rounds).toBe(3);
        room.send('reload-pistol', request('reload-pistol', itemId));
        room.send('shoot-pistol', request('shoot-pistol', itemId));
        await running.exited;
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(
                location =>
                    location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
            ),
        ).toMatchObject({ item: { rounds: 8, revision: 1 } });
        expect(
            saved.initialItemLocations.find(
                location =>
                    location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
            ),
        ).toMatchObject({ item: { quantity: 3 } });
        saved.close();
        running = start(path);
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        let reload;
        let tick = 0;
        state = null;
        room.onMessage('pickup-state', value => {
            state = value;
        });
        room.onMessage('firearm-state', value => {
            reload = value.reload;
        });
        room.onMessage('movement-snapshot', value => {
            tick = value.tick;
        });
        await expect.poll(() => state?.hands?.rounds).toBe(8);
        room.send('shoot-pistol', request('shoot-pistol', itemId, 1));
        await expect.poll(() => state?.hands?.rounds).toBe(7);
        room.send('reload-pistol', request('reload-pistol', itemId, 0));
        const sent = tick;
        await expect.poll(() => tick).toBeGreaterThan(sent + 4);
        expect(reload).toBeNull();
        expect(state.hands.rounds).toBe(7);
        room.send('reload-pistol', request('reload-pistol', itemId, 2));
        await expect.poll(() => state?.hands?.rounds).toBe(8);
        expect(state.items.find(item => item.kind === 'ammo9mm')?.quantity).toBe(2);
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('failed completion stops the real host without publishing a filled magazine or spending the pack', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-reload-failure-'));
    const path = join(directory, 'world.sqlite');
    const itemId = seed(path);
    const database = new DatabaseSync(path);
    database.exec(
        "CREATE TRIGGER reject_reload BEFORE UPDATE OF item_location ON solo_world BEGIN SELECT RAISE(ABORT, 'fixture reload failure'); END",
    );
    database.close();
    const running = start(path);
    let room;
    const received = [];
    try {
        await expect.poll(running.output).toContain('Local world ready');
        room = await connect();
        room.onMessage('pickup-state', value => {
            received.push(value);
        });
        room.send('reload-pistol', request('reload-pistol', itemId));
        await running.exited;
        expect(running.output()).toContain(
            'Solo save failed; stopping host: fixture reload failure',
        );
        expect(received.length).toBeGreaterThan(0);
        expect(received.every(state => state.hands?.rounds === 3)).toBe(true);
        expect(
            received.every(
                state => state.items.find(item => item.kind === 'ammo9mm')?.quantity === 8,
            ),
        ).toBe(true);
        const saved = new SoloWorldStore(path);
        expect(
            saved.initialItemLocations.find(
                location =>
                    location.item.itemId === 'pistol-v1:0:0' && location.item.kind === 'pistol',
            ),
        ).toMatchObject({ item: { rounds: 3 } });
        expect(
            saved.initialItemLocations.find(
                location =>
                    location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
            ),
        ).toMatchObject({ item: { quantity: 8 } });
        saved.close();
    } finally {
        room?.connection.close();
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('world ammo pickup preserves a partial quantity through inventory and reload without respawning the pack', async ({
    page,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'zombi-ammo-loot-ui-'));
    const path = join(directory, 'world.sqlite');
    const store = new SoloWorldStore(path);
    const playerId = store.initialWorld.playerId;
    const ground = store.initialItemLocations.find(
        location => location.item.itemId === 'ammo9mm-v1:0:0' && location.item.kind === 'ammo9mm',
    );
    if (ground?.type !== 'ground') throw new Error('Missing world ammo');
    store.savePosition(ground.item.position);
    store.saveItemLocations(
        store.initialItemLocations.map(location => {
            if (location.item.itemId === 'pistol-v1:0:0')
                return {
                    type: 'hands',
                    playerId,
                    item: {
                        itemId: location.item.itemId,
                        kind: 'pistol',
                        magazineCapacity: 8,
                        rounds: 0,
                    },
                };
            if (
                location.type === 'ground' &&
                location.item.itemId === 'ammo9mm-v1:0:0' &&
                location.item.kind === 'ammo9mm'
            )
                return { ...location, item: { ...location.item, quantity: 3 } };
            return location;
        }),
    );
    store.close();
    const running = start(path);
    try {
        await expect.poll(running.output).toContain('Local world ready');
        await page.goto(origin);
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 0/8');
        await expect(page.locator('#pistol-reload')).toBeDisabled();
        await page.getByRole('button', { name: 'Взять: Патроны 9 мм ×3', exact: true }).click();
        await expect(pack(page)).toContainText('×3');
        await expect(pack(page)).toContainText('36 г');
        await page.screenshot({ path: '.cache/t038-ammo-loot.png', fullPage: true });
        await clickGameAction(page, page.locator('#pistol-reload'));
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(pack(page)).toHaveCount(0);
        await page.reload();
        await expect(page.locator('#ammo-label')).toHaveText('Патроны: 3/8');
        await expect(pack(page)).toHaveCount(0);
    } finally {
        await stop(running);
        rmSync(directory, { recursive: true, force: true });
    }
});
