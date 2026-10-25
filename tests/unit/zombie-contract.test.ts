import { initialZombie } from '@zombi-survive/content';
import { isZombieSnapshot, type ZombieSnapshot } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

const snapshot: ZombieSnapshot = {
    type: 'zombie-state',
    protocolVersion: 5,
    zombieVersion: 1,
    worldId: 'world',
    tick: 1,
    zombies: [initialZombie],
};
test('zombie snapshots survive JSON roundtrip, including idle and empty interest windows', () => {
    expect(isZombieSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);
    expect(isZombieSnapshot({ ...snapshot, zombies: [] })).toBe(true);
    expect(
        isZombieSnapshot({
            ...snapshot,
            zombies: [{ ...initialZombie, targetPlayerId: 'player' }],
        }),
    ).toBe(true);
});
test.each([
    null,
    {},
    { ...snapshot, protocolVersion: 4 },
    { ...snapshot, zombieVersion: 2 },
    { ...snapshot, tick: -1 },
    { ...snapshot, tick: 0.5 },
    { ...snapshot, worldId: '' },
    { ...snapshot, zombies: [initialZombie, initialZombie] },
    ...[
        null,
        {},
        { ...initialZombie, zombieId: ' ' },
        { ...initialZombie, targetPlayerId: 1 },
        { ...initialZombie, position: { xMeters: Infinity, yMeters: 0 } },
        { ...initialZombie, position: { xMeters: 0, yMeters: NaN } },
    ].map(zombie => ({ ...snapshot, zombies: [zombie] })),
])('rejects malformed zombie state: %j', value => {
    expect(isZombieSnapshot(value)).toBe(false);
});
