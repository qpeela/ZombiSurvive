import {
    isMeleeCommand,
    isMeleeSnapshot,
    meleeVersion,
    protocolVersion,
} from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

const command = { type: 'melee-attack', protocolVersion, meleeVersion };
const snapshot = {
    type: 'melee-state',
    protocolVersion,
    meleeVersion,
    worldId: 'world',
    playerId: 'player',
    tick: 0,
    weapon: null,
};
test('melee messages survive JSON and reject malformed versions, ticks and equipment', () => {
    expect(isMeleeCommand(JSON.parse(JSON.stringify(command)))).toBe(true);
    expect(isMeleeCommand({ ...command, type: 'equip-weapon', weapon: 'club' })).toBe(true);
    expect(isMeleeSnapshot(snapshot)).toBe(true);
    expect(isMeleeSnapshot({ ...snapshot, weapon: 'club' })).toBe(true);
    for (const value of [
        null,
        [],
        {},
        { ...command, protocolVersion: 4 },
        { ...command, meleeVersion: 1 },
        { ...command, type: 'kill' },
    ]) {
        expect(isMeleeCommand(value)).toBe(false);
    }
    for (const fields of [
        { tick: -1 },
        { tick: Infinity },
        { tick: 0.5 },
        { worldId: '' },
        { playerId: ' ' },
        { weapon: 'gun' },
        { meleeVersion: 1 },
    ]) {
        expect(isMeleeSnapshot({ ...snapshot, ...fields })).toBe(false);
    }
});

test.each(['club', 'knife', 'crowbar', 'axe'])('%s equipment survives the wire', weapon => {
    const equip = { ...command, type: 'equip-weapon', weapon };
    expect(isMeleeCommand(JSON.parse(JSON.stringify(equip)))).toBe(true);
    expect(isMeleeSnapshot(JSON.parse(JSON.stringify({ ...snapshot, weapon })))).toBe(true);
});

test.each([undefined, null, '', 'gun', 'toString', '__proto__', {}, 1])(
    'unknown equipment is rejected: %j',
    weapon => {
        expect(isMeleeCommand({ ...command, type: 'equip-weapon', weapon })).toBe(false);
        if (weapon !== null) expect(isMeleeSnapshot({ ...snapshot, weapon })).toBe(false);
    },
);
