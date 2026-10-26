import { type HealthSnapshot, isHealthSnapshot } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

const snapshot: HealthSnapshot = {
    type: 'health-state',
    protocolVersion: 5,
    healthVersion: 1,
    worldId: 'world',
    playerId: 'player',
    tick: 1,
    health: 90,
    maxHealth: 100,
};
test('health snapshots survive JSON roundtrip including zero', () => {
    expect(isHealthSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);
    expect(isHealthSnapshot({ ...snapshot, health: 0 })).toBe(true);
});
test.each([
    null,
    [],
    {},
    ...[
        { type: 'attack' },
        { protocolVersion: 4 },
        { healthVersion: 2 },
        { worldId: '' },
        { playerId: ' player ' },
        { tick: -1 },
        { tick: 0.5 },
        { tick: Number.MAX_SAFE_INTEGER + 1 },
        { health: -1 },
        { health: 101 },
        { health: 0.5 },
        { health: NaN },
        { health: Infinity },
        { health: '90' },
        { maxHealth: 0 },
        { maxHealth: Infinity },
        { maxHealth: 100.5 },
    ].map(fields => ({ ...snapshot, ...fields })),
])('rejects malformed health snapshots: %j', value => {
    expect(isHealthSnapshot(value)).toBe(false);
});
