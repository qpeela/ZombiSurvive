import type { PlayerMovementState, WorldId } from '@zombi-survive/domain';
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

export const readMovementTarget = (value: unknown): MovementTargetCommand | null => {
    if (!isMovementTargetCommand(value)) {
        return null;
    }

    return {
        type: value.type,
        protocolVersion: value.protocolVersion,
        sequence: value.sequence,
        isSprinting: value.isSprinting,
        isSneaking: value.isSneaking,
        target: { xMeters: value.target.xMeters, yMeters: value.target.yMeters },
    };
};

export const readMovementInput = (value: unknown): MovementInputCommand | null => {
    if (!isMovementInputCommand(value)) {
        return null;
    }

    return {
        type: value.type,
        protocolVersion: value.protocolVersion,
        sequence: value.sequence,
        isSprinting: value.isSprinting,
        isSneaking: value.isSneaking,
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
        player: copyMovementPlayer(player),
        lastProcessedInputSequence,
        otherPlayers: otherPlayers.map(copyMovementPlayer),
    };

    if (!isMovementSnapshot(snapshot)) {
        throw new Error('Invalid movement snapshot.');
    }

    return snapshot;
};
