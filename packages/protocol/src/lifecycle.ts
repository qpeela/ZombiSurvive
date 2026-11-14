import { protocolVersion } from './movement.ts';

export type RespawnCommand = {
    readonly type: 'respawn-player';
    readonly protocolVersion: typeof protocolVersion;
    readonly lifeRevision: number;
};

export const isCurrentLifeCommand = (value: unknown, lifeRevision: number): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    const revision = 'lifeRevision' in value ? value.lifeRevision : 0;
    return revision === lifeRevision;
};

export const isRespawnCommand = (value: unknown): value is RespawnCommand => {
    if (typeof value !== 'object' || value === null) return false;
    const revision = 'lifeRevision' in value ? value.lifeRevision : undefined;
    const isRevision =
        typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;
    return (
        'type' in value &&
        value.type === 'respawn-player' &&
        'protocolVersion' in value &&
        value.protocolVersion === protocolVersion &&
        isRevision
    );
};
