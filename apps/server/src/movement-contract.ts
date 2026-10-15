import type { PlayerMovementState, WorldId } from '@zombi-survive/domain';
import {
    isMovementInputCommand,
    isMovementSnapshot,
    type MovementInputCommand,
    type MovementSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';

export const readMovementInput = (value: unknown): MovementInputCommand | null => {
    if (!isMovementInputCommand(value)) {
        return null;
    }

    return {
        type: value.type,
        protocolVersion: value.protocolVersion,
        sequence: value.sequence,
        direction: { x: value.direction.x, y: value.direction.y },
    };
};

export const createMovementSnapshot = (
    worldId: WorldId,
    tick: number,
    player: PlayerMovementState,
    lastProcessedInputSequence: number | null,
    otherPlayers: readonly PlayerMovementState[] = [],
): MovementSnapshot => {
    const snapshot: MovementSnapshot = {
        type: 'movement-snapshot',
        protocolVersion,
        worldId,
        tick,
        player: {
            playerId: player.playerId,
            position: { xMeters: player.position.xMeters, yMeters: player.position.yMeters },
        },
        lastProcessedInputSequence,
        otherPlayers: otherPlayers.map(other => ({
            playerId: other.playerId,
            position: { ...other.position },
        })),
    };

    if (!isMovementSnapshot(snapshot)) {
        throw new Error('Invalid movement snapshot.');
    }

    return snapshot;
};
