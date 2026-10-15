import { expect, test } from 'vitest';

import { WorldAccess } from '../../apps/server/src/world-access.ts';

const cookieHeaders = (cookie: string | null): Headers =>
    new Headers({ cookie: cookie?.split(';')[0] ?? '' });

test('solo shares a server identity without exposing invitations or accepting supplied IDs', () => {
    const access = new WorldAccess(false, 3001);
    expect(access.invitations).toEqual([]);
    expect(access.authenticate(new Headers())).toBe(access.soloPlayerId);
    expect(access.authenticate(new Headers({ 'x-player-id': 'forged' }))).toBe(access.soloPlayerId);
    expect(access.redeem('a'.repeat(64))).toBeNull();
});

test('one-time invitations create distinct opaque identities restored only by the session cookie', () => {
    const access = new WorldAccess(true, 3001, 1000);
    const first = access.invitations[0];
    const second = access.invitations[1];
    const cookie = access.redeem(first, 1001);
    const otherCookie = access.redeem(second, 1001);
    const identity = access.authenticate(cookieHeaders(cookie));
    expect(identity).toBeTruthy();
    expect(identity).not.toBe(access.authenticate(cookieHeaders(otherCookie)));
    expect(cookie).toContain('HttpOnly; SameSite=Strict; Path=/');
    expect(access.authenticate(cookieHeaders(cookie))).toBe(identity);
    expect(access.redeem(first, 1002)).toBeNull();
    expect(access.authenticate(new Headers())).toBeNull();
    expect(
        access.authenticate(new Headers({ cookie: `zombi-session-3001=${String(identity)}` })),
    ).toBeNull();
    expect(
        access.authenticate(new Headers({ cookie: `zombi-session-3001=${String(first)}` })),
    ).toBeNull();
    expect(
        access.authenticate(new Headers({ cookie: `zombi-session-3002=${String(cookie)}` })),
    ).toBeNull();
    expect(
        access.authenticate(new Headers({ cookie: `${String(cookie)}; ${String(cookie)}` })),
    ).toBeNull();
});

test('malformed, unknown and expired invitations cannot allocate a session', () => {
    const access = new WorldAccess(true, 3001, 0);

    for (const value of [null, {}, [], 1, '', 'a'.repeat(63), 'A'.repeat(64), 'a'.repeat(64)]) {
        expect(access.redeem(value, 1)).toBeNull();
    }

    expect(access.redeem(access.invitations[0], 30 * 60 * 1000)).toBeNull();
    expect(new Set(access.invitations).size).toBe(8);
});
