import type { MovementDirection, MovementModifiers, WorldPosition } from '@zombi-survive/domain';
import {
    copyMovementPlayer,
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
    { isSprinting = false, isSneaking = false }: MovementModifiers = {},
): MovementTargetCommand => {
    const command: MovementTargetCommand = {
        type: 'movement-target',
        protocolVersion,
        sequence,
        isSprinting,
        isSneaking,
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
    { isSprinting = false, isSneaking = false }: MovementModifiers = {},
): MovementInputCommand => {
    const command: MovementInputCommand = {
        type: 'movement-input',
        protocolVersion,
        sequence,
        isSprinting,
        isSneaking,
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
        ...(value.worldTimeMs === undefined ? {} : { worldTimeMs: value.worldTimeMs }),
        player: copyMovementPlayer(value.player),
        otherPlayers: value.otherPlayers.map(copyMovementPlayer),
        lastProcessedInputSequence: value.lastProcessedInputSequence,
    };
};
