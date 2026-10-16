import { movementSettings } from '@zombi-survive/content';
import type { MovementDirection, PlayerMovementState, WorldPosition } from '@zombi-survive/domain';

export const movementStepSeconds = 1 / movementSettings.ticksPerSecond;

export const stepPlayerToward = (
    player: PlayerMovementState,
    target: WorldPosition,
    stepSeconds: number,
): PlayerMovementState => {
    if (stepSeconds !== movementStepSeconds) {
        throw new RangeError('Movement requires the configured fixed stepSeconds.');
    }

    const dx = target.xMeters - player.position.xMeters;
    const dy = target.yMeters - player.position.yMeters;
    const distance = Math.hypot(dx, dy);
    const stepDistance = movementSettings.walkSpeedMetersPerSecond * stepSeconds;

    if (distance <= stepDistance) {
        return { ...player, position: { ...target } };
    }

    return {
        ...player,
        position: {
            xMeters: player.position.xMeters + (dx / distance) * stepDistance,
            yMeters: player.position.yMeters + (dy / distance) * stepDistance,
        },
    };
};

/** Advance one fixed tick using validated domain values, without changing their owners. */
export const stepPlayerMovement = (
    player: PlayerMovementState,
    direction: MovementDirection,
    stepSeconds: number,
): PlayerMovementState => {
    if (stepSeconds !== movementStepSeconds) {
        throw new RangeError('Movement requires the configured fixed stepSeconds.');
    }

    const directionLength = Math.hypot(direction.x, direction.y);
    const distanceMeters = movementSettings.walkSpeedMetersPerSecond * stepSeconds;
    const movementScale = directionLength === 0 ? 0 : distanceMeters / directionLength;

    return {
        playerId: player.playerId,
        position: {
            xMeters: player.position.xMeters + direction.x * movementScale,
            yMeters: player.position.yMeters + direction.y * movementScale,
        },
    };
};
