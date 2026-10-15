import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { maxWorldPlayers } from '@zombi-survive/protocol';

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');
const isToken = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export class WorldAccess {
    readonly soloPlayerId = randomUUID();
    readonly invitations: readonly string[];
    readonly cookieName: string;
    private readonly pending = new Map<string, { playerId: string; expiresAtMs: number }>();
    private readonly sessions = new Map<string, string>();
    private readonly isCooperative: boolean;

    constructor(isCooperative: boolean, port: number, nowMs = Date.now()) {
        this.isCooperative = isCooperative;
        this.cookieName = `zombi-session-${String(port)}`;
        this.invitations = isCooperative
            ? Array.from({ length: maxWorldPlayers }, () => randomBytes(32).toString('hex'))
            : [];

        for (const token of this.invitations) {
            this.pending.set(digest(token), {
                playerId: randomUUID(),
                expiresAtMs: nowMs + 30 * 60 * 1000,
            });
        }
    }

    redeem(value: unknown, nowMs = Date.now()): string | null {
        if (!isToken(value)) {
            return null;
        }

        const key = digest(value);
        const invitation = this.pending.get(key);

        if (invitation === undefined || invitation.expiresAtMs <= nowMs) {
            return null;
        }

        this.pending.delete(key);
        const session = randomBytes(32).toString('hex');
        this.sessions.set(digest(session), invitation.playerId);

        return `${this.cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`;
    }

    authenticate(headers: Headers): string | null {
        if (!this.isCooperative) {
            return this.soloPlayerId;
        }

        const cookies = (headers.get('cookie') ?? '').split(';').map(cookie => cookie.trim());
        const values = cookies.filter(cookie => cookie.startsWith(`${this.cookieName}=`));

        if (values.length !== 1) {
            return null;
        }

        const value = values[0]?.slice(this.cookieName.length + 1);

        return isToken(value) ? (this.sessions.get(digest(value)) ?? null) : null;
    }
}
