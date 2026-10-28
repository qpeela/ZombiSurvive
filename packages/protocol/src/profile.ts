import { isDisplayName } from '@zombi-survive/domain';

import { protocolVersion } from './movement.ts';

export const profileVersion = 1;
export type RenamePlayerCommand = {
    readonly type: 'rename-player';
    readonly protocolVersion: typeof protocolVersion;
    readonly profileVersion: typeof profileVersion;
    readonly displayName: string;
};
export type ProfileSnapshot = {
    readonly type: 'profile-state';
    readonly protocolVersion: typeof protocolVersion;
    readonly profileVersion: typeof profileVersion;
    readonly worldId: string;
    readonly playerId: string;
    readonly revision: number;
    readonly displayName: string;
};
export type ProfileResult =
    | { readonly status: 'saved'; readonly profile: ProfileSnapshot }
    | { readonly status: 'invalid' | 'unavailable' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isVersion = (value: Record<string, unknown>): boolean =>
    value['protocolVersion'] === protocolVersion && value['profileVersion'] === profileVersion;
const isId = (value: unknown): boolean =>
    typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;

export const isRenamePlayerCommand = (value: unknown): value is RenamePlayerCommand => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        value['type'] === 'rename-player' && isVersion(value) && isDisplayName(value['displayName'])
    );
};
export const isProfileSnapshot = (value: unknown): value is ProfileSnapshot => {
    if (!isRecord(value)) {
        return false;
    }

    const revision = value['revision'];
    const isRevision =
        typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;

    return (
        value['type'] === 'profile-state' &&
        isVersion(value) &&
        isRevision &&
        isId(value['worldId']) &&
        isId(value['playerId']) &&
        isDisplayName(value['displayName'])
    );
};
export const isProfileResult = (value: unknown): value is ProfileResult => {
    if (!isRecord(value)) {
        return false;
    }

    if (value['status'] === 'saved') {
        return isProfileSnapshot(value['profile']);
    }

    return value['status'] === 'invalid' || value['status'] === 'unavailable';
};
