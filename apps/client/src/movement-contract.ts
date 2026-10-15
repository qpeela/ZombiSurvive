import type { MovementDirection } from '@zombi-survive/domain';
import {
    isMovementInputCommand,
    isMovementSnapshot,
    type MovementInputCommand,
    type MovementSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';

export const createMovementInput = (
    sequence: number,
    direction: MovementDirection,
): MovementInputCommand => {
    const command: MovementInputCommand = {
        type: 'movement-input',
        protocolVersion,
        sequence,
        direction: { x: direction.x, y: direction.y },
    };

    if (!isMovementInputCommand(command)) {
        throw new Error('Invalid movement input.');
    }

    return command;
};

export const readMovementSnapshot = (value: unknown): MovementSnapshot | null => {
    if (!isMovementSnapshot(value)) {
        return null;
    }

    return {
        type: value.type,
        protocolVersion: value.protocolVersion,
        worldId: value.worldId,
        tick: value.tick,
        player: {
            playerId: value.player.playerId,
            position: {
                xMeters: value.player.position.xMeters,
                yMeters: value.player.position.yMeters,
            },
        },
        otherPlayers: value.otherPlayers.map(player => ({
            playerId: player.playerId,
            position: { ...player.position },
        })),
        lastProcessedInputSequence: value.lastProcessedInputSequence,
    };
};
