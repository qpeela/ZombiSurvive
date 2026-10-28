import {
    isRenamePlayerCommand,
    type MovementSnapshot,
    type ProfileResult,
    type ProfileSnapshot,
    profileVersion,
    protocolVersion,
} from '@zombi-survive/protocol';

import type { SoloWorldStore } from './solo-world-store.ts';

export const createLocalWorldProfile = (
    store?: Pick<SoloWorldStore, 'initialWorld' | 'currentProfile' | 'saveDisplayName'>,
): {
    snapshot: (movement: MovementSnapshot) => ProfileSnapshot | null;
    rename: (movement: MovementSnapshot, command: unknown) => ProfileResult;
} => {
    const snapshot = (movement: MovementSnapshot): ProfileSnapshot | null => {
        if (store === undefined || movement.player.playerId !== store.initialWorld.playerId) {
            return null;
        }

        const { displayName, nameRevision } = store.currentProfile();

        return {
            type: 'profile-state',
            protocolVersion,
            profileVersion,
            worldId: movement.worldId,
            playerId: movement.player.playerId,
            revision: nameRevision,
            displayName,
        };
    };

    return {
        snapshot,
        rename: (movement, command) => {
            if (!isRenamePlayerCommand(command)) {
                return { status: 'invalid' };
            }

            if (store === undefined || snapshot(movement) === null) {
                return { status: 'unavailable' };
            }

            try {
                // A message handler owns this synchronous commit, outside the simulation step.
                store.saveDisplayName(command.displayName);
                const profile = snapshot(movement);

                return profile === null ? { status: 'unavailable' } : { status: 'saved', profile };
            } catch {
                return { status: 'unavailable' };
            }
        },
    };
};
