/// <reference lib="dom" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createWorldSession } from '../../apps/client/src/world-session.ts';

const replaceState = vi.fn();
const request = vi.fn<typeof fetch>();

beforeEach(() => {
    request.mockReset();
    replaceState.mockReset();
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('window', {
        location: { hash: '#invite=secret', pathname: '/', search: '?keep=1' },
        history: { replaceState },
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
});

test('removes the invitation from browser history before any request and redeems it once', async () => {
    request.mockResolvedValue(new Response(null, { status: 204 }));
    const session = createWorldSession();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?keep=1');
    expect(request).not.toHaveBeenCalled();
    await session.ensure();
    await session.ensure();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
        '/session',
        expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin',
            body: JSON.stringify({ invitation: 'secret' }),
        }),
    );
    session.cancel();
});

test('an ordinary solo page or a returning cookie session does not redeem another invitation', async () => {
    window.location.hash = '';
    const session = createWorldSession();
    await session.ensure();
    expect(request).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
});

test('a failed redemption can retry, but cancelled work cannot mark a session ready', async () => {
    request.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const session = createWorldSession();
    await expect(session.ensure()).rejects.toThrow('Invitation rejected');
    let resolve: (value: Response) => void = () => {};
    request.mockImplementationOnce(
        () =>
            new Promise<Response>(callback => {
                resolve = callback;
            }),
    );
    const pending = session.ensure();
    session.cancel();
    resolve(new Response(null, { status: 204 }));
    await expect(pending).rejects.toThrow();
    request.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await session.ensure();
    expect(request).toHaveBeenCalledTimes(3);
    session.cancel();
});
