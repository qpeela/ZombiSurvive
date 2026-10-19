import { Client } from '@colyseus/sdk';
import { expect, test } from '@playwright/test';
import { initialStateRequest, localWorldRoomId } from '@zombi-survive/protocol';

const readPosition = page =>
    page.getByRole('status').evaluate(element => ({
        x: Number(element.dataset.xMeters),
        y: Number(element.dataset.yMeters),
        tick: Number(element.dataset.tick),
        ack: element.dataset.ack,
        playerId: element.dataset.playerId,
    }));
const waitTicks = async (page, tick) => {
    await expect.poll(async () => (await readPosition(page)).tick).toBeGreaterThanOrEqual(tick);
};
const connectPage = async page => {
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'true');
    await page.getByRole('heading').click();

    return readPosition(page);
};
const waitStopped = async page => {
    const position = await readPosition(page);
    // At most two server steps until the 10 Hz client sends a release.
    await waitTicks(page, position.tick + 4);
    const stopped = await readPosition(page);
    await waitTicks(page, stopped.tick + 4);
    const later = await readPosition(page);
    expect(later.x).toBe(stopped.x);
    expect(later.y).toBe(stopped.y);

    return later;
};

test('WASD moves the visible character from server snapshots; opposing keys stop it', async ({
    page,
}) => {
    const start = await connectPage(page);
    await page.keyboard.down('d');
    await expect.poll(async () => (await readPosition(page)).x).toBeGreaterThan(start.x + 0.2);
    await page.keyboard.up('d');
    const right = await waitStopped(page);
    expect(right.y).toBe(start.y);
    expect(right.ack).not.toBe('null');
    const canvas = page.locator('canvas');
    expect(Number(await canvas.getAttribute('data-player-x'))).toBeCloseTo(480 + right.x * 24, 8);
    expect(Number(await canvas.getAttribute('data-player-y'))).toBeCloseTo(270 + right.y * 24, 8);

    await page.keyboard.down('w');
    await page.keyboard.down('a');
    await expect.poll(async () => (await readPosition(page)).y).toBeLessThan(right.y - 0.2);
    await page.keyboard.down('s');
    await page.keyboard.down('d');
    const opposed = await waitStopped(page);
    expect(opposed.x).toBeLessThan(right.x);

    await page.keyboard.up('w');
    await page.keyboard.up('a');
    await expect.poll(async () => (await readPosition(page)).y).toBeGreaterThan(opposed.y + 0.2);
    await page.keyboard.up('s');
    await page.keyboard.up('d');
    const final = await waitStopped(page);
    expect(final.x).toBeGreaterThan(opposed.x);
    await page.reload();
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    expect(await readPosition(page)).toMatchObject({
        x: final.x,
        y: final.y,
        playerId: start.playerId,
        ack: 'null',
    });
});

test('blur and connection loss clear held keys; retry waits for fresh input', async ({
    page,
    context,
}) => {
    const start = await connectPage(page);
    await page.keyboard.down('d');
    await expect.poll(async () => (await readPosition(page)).x).toBeGreaterThan(start.x + 0.2);
    await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
    await waitStopped(page);
    await page.keyboard.up('d');
    await page.keyboard.down('a');
    const before = await readPosition(page);
    await expect.poll(async () => (await readPosition(page)).x).toBeLessThan(before.x - 0.2);
    await context.setOffline(true);
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'disconnected');
    await expect(page.locator('canvas')).toHaveAttribute('data-player-visible', 'false');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Подключиться снова' }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-status', 'connected');
    await waitStopped(page);
    await page.keyboard.up('a');
    await page.getByRole('heading').click();
    await page.keyboard.down('s');
    const rejoined = await readPosition(page);
    await expect.poll(async () => (await readPosition(page)).y).toBeGreaterThan(rejoined.y + 0.2);
    await page.keyboard.up('s');
    await waitStopped(page);
});

test('real transport applies intentions once per tick and isolates session acknowledgements', async () => {
    const client = new Client('http://127.0.0.1:3101', {
        headers: { Origin: 'http://127.0.0.1:4173' },
    });
    const first = await client.joinById(localWorldRoomId);
    const second = await client.joinById(localWorldRoomId);
    const received = [];
    const other = [];
    first.onMessage('movement-snapshot', snapshot => received.push(snapshot));
    second.onMessage('movement-snapshot', snapshot => other.push(snapshot));
    const command = (sequence, direction) => ({
        type: 'movement-input',
        protocolVersion: 5,
        isSprinting: false,
        isSneaking: false,
        sequence,
        direction,
        playerId: 'forged',
        position: { xMeters: 99999, yMeters: 99999 },
    });

    try {
        const start = await first.request(initialStateRequest);
        first.send('movement-input', command(1, { x: 1, y: 0 }));
        await expect
            .poll(() => received.find(s => s.lastProcessedInputSequence === 1))
            .toBeTruthy();
        const moved = received.find(s => s.lastProcessedInputSequence === 1);
        expect(moved.player.position.xMeters - start.player.position.xMeters).toBeCloseTo(0.2, 8);
        expect(moved.player.playerId).toBe(start.player.playerId);
        first.send('movement-input', command(2, { x: 0, y: 0 }));
        await expect
            .poll(() => received.find(s => s.lastProcessedInputSequence === 2))
            .toBeTruthy();
        const stopped = received.find(s => s.lastProcessedInputSequence === 2);
        first.send('movement-input', command(2, { x: -1, y: 0 }));
        first.send('movement-input', command(1, { x: 1, y: 0 }));
        first.send('movement-input', command(3, { x: 7, y: 0 }));
        await expect.poll(() => received.at(-1)?.tick ?? 0).toBeGreaterThan(stopped.tick + 4);
        expect(received.at(-1).player.position).toEqual(stopped.player.position);
        expect(received.at(-1).lastProcessedInputSequence).toBe(2);
        expect(other.at(-1).lastProcessedInputSequence).toBeNull();
        await first.leave();
        const replacement = await client.joinById(localWorldRoomId);

        try {
            const snapshot = await replacement.request(initialStateRequest);
            expect(snapshot.player).toEqual(stopped.player);
            expect(snapshot.lastProcessedInputSequence).toBeNull();
        } finally {
            await replacement.leave();
        }
    } finally {
        first.connection.close();
        await second.leave();
    }
});
