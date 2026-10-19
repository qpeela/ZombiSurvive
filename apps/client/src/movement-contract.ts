import type { MovementDirection, WorldPosition } from '@zombi-survive/domain';
import {
    isMovementInputCommand,
    isMovementSnapshot,
    isMovementTargetCommand,
    type MovementInputCommand,
    type MovementSnapshot,
    type MovementTargetCommand,
    protocolVersion,
} from '@zombi-survive/protocol';

export const createMovementTarget = (
    sequence: number,
    target: WorldPosition,
    isSprinting = false,
): MovementTargetCommand => {
    const command: MovementTargetCommand = {
        type: 'movement-target',
        protocolVersion,
        sequence,
        isSprinting,
        target: { xMeters: target.xMeters, yMeters: target.yMeters },
    };

    if (!isMovementTargetCommand(command)) {
        throw new Error('Invalid movement target.');
    }

    return command;
};

export const createMovementInput = (
    sequence: number,
    direction: MovementDirection,
    isSprinting = false,
): MovementInputCommand => {
    const command: MovementInputCommand = {
        type: 'movement-input',
        protocolVersion,
        sequence,
        isSprinting,
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
            stamina: value.player.stamina,
            isExhausted: value.player.isExhausted,
            position: {
                xMeters: value.player.position.xMeters,
                yMeters: value.player.position.yMeters,
            },
        },
        otherPlayers: value.otherPlayers.map(player => ({
            playerId: player.playerId,
            stamina: player.stamina,
            isExhausted: player.isExhausted,
            position: { ...player.position },
        })),
        lastProcessedInputSequence: value.lastProcessedInputSequence,
    };
};
