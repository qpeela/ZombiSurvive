import type { MovementSnapshot } from '@zombi-survive/protocol';
import { expect, test, vi } from 'vitest';

import { createLocalWorldProfile } from '../../apps/server/src/local-world-profile.ts';
import type { SavedSoloWorld } from '../../apps/server/src/solo-world-store.ts';

const saved: SavedSoloWorld = {
    worldId: 'world',
    playerId: 'player',
    position: { xMeters: 0, yMeters: 0 },
    displayName: 'Выживший',
    nameRevision: 0,
};
const movement: MovementSnapshot = {
    type: 'movement-snapshot',
    protocolVersion: 5,
    worldId: 'world',
    tick: 1,
    player: {
        playerId: 'player',
        position: saved.position,
        stamina: 1,
        isExhausted: false,
        isSneaking: false,
        noiseRadiusMeters: 0,
    },
    otherPlayers: [],
    lastProcessedInputSequence: null,
};
const command = {
    type: 'rename-player',
    protocolVersion: 5,
    profileVersion: 1,
    displayName: 'Иван',
};

test('rename uses authenticated movement identity and persistence errors cannot acknowledge a name', () => {
    const saveDisplayName = vi.fn(() => {
        throw new Error('disk failure');
    });
    const profile = createLocalWorldProfile({
        initialWorld: saved,
        currentProfile: () => saved,
        saveDisplayName,
    });
    expect(profile.rename(movement, command)).toEqual({ status: 'unavailable' });
    expect(profile.snapshot(movement)?.displayName).toBe('Выживший');
    saveDisplayName.mockClear();
    const foreign = { ...movement, player: { ...movement.player, playerId: 'friend' } };
    expect(profile.rename(foreign, command)).toEqual({ status: 'unavailable' });
    expect(profile.snapshot(foreign)).toBeNull();
    expect(profile.rename(movement, { ...command, displayName: '<b>' })).toEqual({
        status: 'invalid',
    });
    expect(saveDisplayName).not.toHaveBeenCalled();
    expect(createLocalWorldProfile().rename(movement, command)).toEqual({ status: 'unavailable' });
});
