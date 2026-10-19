import type { PlayerMovementState, WorldId } from '@zombi-survive/domain';
import {
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
        player: {
            playerId: player.playerId,
            stamina: player.stamina,
            isExhausted: player.isExhausted,
            isSneaking: player.isSneaking,
            noiseRadiusMeters: player.noiseRadiusMeters,
            position: { xMeters: player.position.xMeters, yMeters: player.position.yMeters },
        },
        lastProcessedInputSequence,
        otherPlayers: otherPlayers.map(other => ({
            playerId: other.playerId,
            stamina: other.stamina,
            isExhausted: other.isExhausted,
            isSneaking: other.isSneaking,
            noiseRadiusMeters: other.noiseRadiusMeters,
            position: { ...other.position },
        })),
    };

    if (!isMovementSnapshot(snapshot)) {
        throw new Error('Invalid movement snapshot.');
    }

    return snapshot;
};
