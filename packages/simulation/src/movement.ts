import { movementSettings } from '@zombi-survive/content';
import type { MovementDirection, PlayerMovementState } from '@zombi-survive/domain';

export const movementStepSeconds = 1 / movementSettings.ticksPerSecond;

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
