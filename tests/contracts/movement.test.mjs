import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { isMovementInputCommand, isMovementSnapshot } from '@zombi-survive/protocol';

import {
    createMovementInput,
    createMovementTarget,
    readMovementSnapshot,
} from '../../apps/client/src/movement-contract.ts';
import {
    createMovementSnapshot,
    readMovementInput,
    readMovementTarget,
} from '../../apps/server/dist/movement-contract.js';

const player = { playerId: 'player-1', position: { xMeters: -2.5, yMeters: 0 } };
const roundTrip = value => JSON.parse(JSON.stringify(value));

test('Node resolves built package exports by default and source exports in development', () => {
    assert.ok(import.meta.resolve('@zombi-survive/protocol').endsWith('/dist/index.js'));

    const result = spawnSync(
        process.execPath,
        [
            '--conditions=development',
            '--input-type=module',
            '-e',
            `import assert from 'node:assert/strict';
             import { createMovementInput } from './apps/client/src/movement-contract.ts';
             import { readMovementInput } from './apps/server/src/movement-contract.ts';
             assert.ok(import.meta.resolve('@zombi-survive/protocol').endsWith('/src/index.ts'));
             const command = createMovementInput(1, { x: 1, y: -1 });
             assert.deepEqual(readMovementInput(JSON.parse(JSON.stringify(command))), command);`,
        ],
        { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
});

test('all keyboard directions, including idle and diagonals, survive client-to-server JSON', () => {
    for (const x of [-1, 0, 1]) {
        for (const y of [-1, 0, 1]) {
            const command = createMovementInput(1, { x, y });
            assert.deepEqual(readMovementInput(roundTrip(command)), command);
        }
    }
});

test('initial state and processed input acknowledgement survive server-to-client JSON', () => {
    for (const sequence of [null, 1, Number.MAX_SAFE_INTEGER]) {
        const snapshot = createMovementSnapshot('world-1', 0, player, sequence);
        assert.deepEqual(readMovementSnapshot(roundTrip(snapshot)), snapshot);
    }
});

test('invalid input sequences are rejected without coercion', () => {
    const command = createMovementInput(1, { x: 0, y: 0 });

    for (const sequence of [undefined, null, '1', 0, -1, 1.5, NaN, Infinity, 2 ** 53]) {
        assert.equal(readMovementInput({ ...command, sequence }), null);
        assert.throws(() => createMovementInput(sequence, command.direction), /Invalid/);
    }

    assert.ok(isMovementInputCommand({ ...command, sequence: Number.MAX_SAFE_INTEGER }));
});

test('axes outside keyboard intentions and malformed directions are rejected', () => {
    const command = createMovementInput(1, { x: 0, y: 0 });

    for (const direction of [null, [], {}, { x: 0 }, { x: 0, y: 2 }, { x: '1', y: 0 }]) {
        assert.equal(readMovementInput({ ...command, direction }), null);
    }

    assert.throws(() => createMovementInput(1, { x: 0.5, y: 0 }), /Invalid/);
});

test('wrong message kinds, versions and non-object payloads are rejected on both sides', () => {
    const command = createMovementInput(1, { x: 0, y: 0 });
    const snapshot = createMovementSnapshot('world-1', 0, player, null);

    for (const value of [null, [], true, 1, 'message', {}]) {
        assert.equal(readMovementInput(value), null);
        assert.equal(readMovementSnapshot(value), null);
    }

    assert.equal(readMovementInput(snapshot), null);
    assert.equal(readMovementSnapshot(command), null);

    for (const protocolVersion of [undefined, '3', 0, 1, 2, 4]) {
        assert.equal(readMovementInput({ ...command, protocolVersion }), null);
        assert.equal(readMovementSnapshot({ ...snapshot, protocolVersion }), null);
    }
});

test('ticks and acknowledgements must be safe integers with distinct initial sentinels', () => {
    const snapshot = createMovementSnapshot('world-1', 0, player, null);

    for (const tick of [undefined, null, '0', -1, 0.5, NaN, Infinity, 2 ** 53]) {
        assert.equal(readMovementSnapshot({ ...snapshot, tick }), null);
    }

    for (const sequence of [undefined, '1', 0, -1, 1.5, NaN, Infinity, 2 ** 53]) {
        assert.equal(
            readMovementSnapshot({ ...snapshot, lastProcessedInputSequence: sequence }),
            null,
        );
    }

    assert.ok(isMovementSnapshot({ ...snapshot, tick: Number.MAX_SAFE_INTEGER }));
});

test('snapshots reject missing players, malformed positions and non-finite coordinates', () => {
    const snapshot = createMovementSnapshot('world-1', 0, player, null);

    for (const invalidPlayer of [null, [], {}, { ...player, position: [] }]) {
        assert.equal(readMovementSnapshot({ ...snapshot, player: invalidPlayer }), null);
    }

    for (const coordinate of [undefined, null, '0', NaN, Infinity, -Infinity]) {
        for (const axis of ['xMeters', 'yMeters']) {
            const invalidPlayer = {
                ...player,
                position: { ...player.position, [axis]: coordinate },
            };
            assert.equal(readMovementSnapshot({ ...snapshot, player: invalidPlayer }), null);
            assert.throws(
                () => createMovementSnapshot('world-1', 0, invalidPlayer, null),
                /Invalid/,
            );
        }
    }
});

test('world and player IDs must be non-empty, bounded strings without outer whitespace', () => {
    const snapshot = createMovementSnapshot('world-1', 0, player, null);

    for (const id of [undefined, null, 1, '', ' ', ' world', 'world ', 'x'.repeat(129)]) {
        assert.equal(readMovementSnapshot({ ...snapshot, worldId: id }), null);
        assert.equal(
            readMovementSnapshot({ ...snapshot, player: { ...player, playerId: id } }),
            null,
        );
    }

    assert.ok(isMovementSnapshot({ ...snapshot, worldId: 'x'.repeat(128) }));
});

test('server extracts only input intentions and does not retain client-owned mutable values', () => {
    const command = createMovementInput(1, { x: 1, y: 0 });
    const incoming = { ...command, playerId: 'other-player', position: { xMeters: 999 } };
    const accepted = readMovementInput(incoming);
    assert.deepEqual(accepted, command);

    incoming.direction.x = -1;
    assert.equal(accepted.direction.x, 1);
});

test('builders and the client snapshot reader detach positions and directions from their owners', () => {
    const direction = { x: 1, y: 0 };
    const command = createMovementInput(1, direction);
    direction.x = -1;
    assert.equal(command.direction.x, 1);

    const mutablePlayer = roundTrip(player);
    const snapshot = createMovementSnapshot('world-1', 1, mutablePlayer, 1);
    mutablePlayer.position.xMeters = 10;
    assert.equal(snapshot.player.position.xMeters, -2.5);

    const accepted = readMovementSnapshot(snapshot);
    snapshot.player.position.xMeters = 20;
    assert.equal(accepted.player.position.xMeters, -2.5);
});

test('version 3 validates a bounded set of distinct peers and detaches their positions', () => {
    const friend = { playerId: 'friend', position: { xMeters: 2, yMeters: 0 } };
    const snapshot = createMovementSnapshot('world-1', 1, player, 1, [friend]);
    const accepted = readMovementSnapshot(roundTrip(snapshot));
    assert.deepEqual(accepted, snapshot);
    friend.position.xMeters = 20;
    assert.equal(snapshot.otherPlayers[0].position.xMeters, 2);
    snapshot.otherPlayers[0].position.xMeters = 30;
    assert.equal(accepted.otherPlayers[0].position.xMeters, 2);

    for (const otherPlayers of [
        undefined,
        null,
        {},
        [player],
        [friend, friend],
        [{ ...friend, position: { xMeters: Infinity, yMeters: 0 } }],
        Array.from({ length: 8 }, (_, index) => ({ ...friend, playerId: `peer-${index}` })),
    ]) {
        assert.equal(readMovementSnapshot({ ...snapshot, otherPlayers }), null);
    }

    assert.equal(readMovementSnapshot({ ...snapshot, protocolVersion: 1 }), null);
});

test('v3 mouse targets are detached intentions and reject old versions and unsafe coordinates', () => {
    const source = { xMeters: -2.25, yMeters: 4.75, playerId: 'forged' };
    const command = createMovementTarget(1, source);
    source.xMeters = 99;
    assert.deepEqual(command.target, { xMeters: -2.25, yMeters: 4.75 });
    const incoming = { ...roundTrip(command), playerId: 'another', position: { xMeters: 999 } };
    incoming.target.extra = 'not-a-coordinate';
    const accepted = readMovementTarget(incoming);
    assert.deepEqual(accepted, command);
    incoming.target.yMeters = 999;
    assert.equal(accepted.target.yMeters, 4.75);
    assert.equal(readMovementInput(command), null);
    assert.equal(readMovementTarget(createMovementInput(1, { x: 1, y: 0 })), null);
    for (const version of [1, 2, 4, '3', undefined]) {
        assert.equal(readMovementTarget({ ...command, protocolVersion: version }), null);
    }
    for (const target of [null, [], {}, { xMeters: 0 }, { xMeters: '1', yMeters: 0 }]) {
        assert.equal(readMovementTarget({ ...command, target }), null);
    }
    for (const value of [NaN, Infinity, -Infinity, 1_000_001, -1_000_001]) {
        for (const axis of ['xMeters', 'yMeters']) {
            const target = { ...command.target, [axis]: value };
            assert.equal(readMovementTarget({ ...command, target }), null);
            assert.throws(() => createMovementTarget(1, target), /Invalid/);
        }
    }
    for (const sequence of [0, -1, 1.5, NaN, 2 ** 53]) {
        assert.equal(readMovementTarget({ ...command, sequence }), null);
    }
    assert.deepEqual(
        readMovementTarget(
            roundTrip(createMovementTarget(2, { xMeters: -1_000_000, yMeters: 1_000_000 })),
        ).target,
        { xMeters: -1_000_000, yMeters: 1_000_000 },
    );
});
