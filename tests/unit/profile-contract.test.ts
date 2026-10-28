import { displayNameMaxLength, isDisplayName } from '@zombi-survive/domain';
import { isProfileResult, isProfileSnapshot, isRenamePlayerCommand } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

const profile = {
    type: 'profile-state',
    protocolVersion: 5,
    profileVersion: 1,
    worldId: 'world',
    playerId: 'player',
    revision: 0,
    displayName: 'Выживший',
};
const rename = { type: 'rename-player', protocolVersion: 5, profileVersion: 1 };

test.each(['Я', 'Ёж_42', 'Anna-Maria', 'Иван Петров', 'a'.repeat(displayNameMaxLength)])(
    'valid display name crosses the wire: %s',
    displayName => {
        expect(isDisplayName(displayName)).toBe(true);
        expect(isRenamePlayerCommand({ ...rename, displayName })).toBe(true);
        expect(isProfileSnapshot(JSON.parse(JSON.stringify({ ...profile, displayName })))).toBe(
            true,
        );
    },
);

test.each([
    '',
    ' ',
    ' Name',
    'Name ',
    'a'.repeat(25),
    '<img src=x>',
    'A\nB',
    'A\u0000B',
    'A\u202eB',
    '😀',
    null,
    42,
    {},
    '__proto__<',
])('invalid names are rejected by command and snapshot: %j', displayName => {
    expect(isDisplayName(displayName)).toBe(false);
    expect(isRenamePlayerCommand({ ...rename, displayName })).toBe(false);
    expect(isProfileSnapshot({ ...profile, displayName })).toBe(false);
});

test('profile contracts reject wrong identity formats, versions, revisions and invalid results', () => {
    for (const fields of [
        { revision: -1 },
        { revision: 1.5 },
        { revision: Infinity },
        { revision: Number.MAX_SAFE_INTEGER + 1 },
        { worldId: '' },
        { playerId: ' ' },
        { protocolVersion: 4 },
        { profileVersion: 2 },
    ]) {
        expect(isProfileSnapshot({ ...profile, ...fields })).toBe(false);
    }
    expect(isRenamePlayerCommand({ ...rename, displayName: 'Иван', profileVersion: 2 })).toBe(
        false,
    );
    expect(isProfileResult({ status: 'saved', profile })).toBe(true);
    expect(isProfileResult({ status: 'invalid' })).toBe(true);
    expect(isProfileResult({ status: 'unavailable' })).toBe(true);
    expect(isProfileResult({ status: 'saved', profile: {} })).toBe(false);
    expect(isProfileResult(null)).toBe(false);
});
