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
    expect(isMeleeCommand({ ...command, type: 'equip-club' })).toBe(true);
    expect(isMeleeSnapshot(snapshot)).toBe(true);
    expect(isMeleeSnapshot({ ...snapshot, weapon: 'club' })).toBe(true);
    for (const value of [
        null,
        [],
        {},
        { ...command, protocolVersion: 4 },
        { ...command, meleeVersion: 2 },
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
        { meleeVersion: 2 },
    ]) {
        expect(isMeleeSnapshot({ ...snapshot, ...fields })).toBe(false);
    }
});
