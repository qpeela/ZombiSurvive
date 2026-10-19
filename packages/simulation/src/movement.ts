import { movementSettings } from '@zombi-survive/content';
import type { MovementDirection, PlayerMovementState, WorldPosition } from '@zombi-survive/domain';

export const movementStepSeconds = 1 / movementSettings.ticksPerSecond;

const prepareStep = ({
    player,
    isMoving,
    isSprinting,
    stepSeconds,
}: {
    player: PlayerMovementState;
    isMoving: boolean;
    isSprinting: boolean;
    stepSeconds: number;
}): { player: PlayerMovementState; distanceMeters: number } => {
    if (stepSeconds !== movementStepSeconds) {
        throw new RangeError('Movement requires the configured fixed stepSeconds.');
    }

    const canSprint = !player.isExhausted && player.stamina > 0;
    const isRunning = isMoving && isSprinting && canSprint;
    const staminaChange = isRunning
        ? -movementSettings.staminaDrainPerSecond
        : movementSettings.staminaRecoveryPerSecond;
    const stamina = Math.min(1, Math.max(0, player.stamina + staminaChange * stepSeconds));
    const isExhausted =
        stamina === 0 || (player.isExhausted && stamina < movementSettings.sprintRecoveryThreshold);
    const speed = isRunning
        ? movementSettings.sprintSpeedMetersPerSecond
        : movementSettings.walkSpeedMetersPerSecond;

    return {
        player: { ...player, stamina, isExhausted },
        distanceMeters: speed * stepSeconds,
    };
};

export const stepPlayerToward = (
    player: PlayerMovementState,
    target: WorldPosition,
    stepSeconds: number,
    isSprinting = false,
): PlayerMovementState => {
    const dx = target.xMeters - player.position.xMeters;
    const dy = target.yMeters - player.position.yMeters;
    const distance = Math.hypot(dx, dy);
    const step = prepareStep({ player, isMoving: distance > 0, isSprinting, stepSeconds });

    if (distance <= step.distanceMeters) {
        return { ...step.player, position: { ...target } };
    }

    return {
        ...step.player,
        position: {
            xMeters: player.position.xMeters + (dx / distance) * step.distanceMeters,
            yMeters: player.position.yMeters + (dy / distance) * step.distanceMeters,
        },
    };
};

/** Advance one fixed tick using validated domain values, without changing their owners. */
export const stepPlayerMovement = (
    player: PlayerMovementState,
    direction: MovementDirection,
    stepSeconds: number,
    isSprinting = false,
): PlayerMovementState => {
    const directionLength = Math.hypot(direction.x, direction.y);
    const step = prepareStep({ player, isMoving: directionLength > 0, isSprinting, stepSeconds });
    const movementScale = directionLength === 0 ? 0 : step.distanceMeters / directionLength;

    return {
        ...step.player,
        position: {
            xMeters: player.position.xMeters + direction.x * movementScale,
            yMeters: player.position.yMeters + direction.y * movementScale,
        },
    };
};
