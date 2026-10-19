import { movementSettings } from '@zombi-survive/content';
import type {
    MovementDirection,
    MovementModifiers,
    PlayerMovementState,
    WorldPosition,
} from '@zombi-survive/domain';

export const movementStepSeconds = 1 / movementSettings.ticksPerSecond;

const prepareStep = ({
    player,
    isMoving,
    isSprinting,
    isSneaking,
    stepSeconds,
}: {
    player: PlayerMovementState;
    isMoving: boolean;
    isSprinting: boolean;
    isSneaking: boolean;
    stepSeconds: number;
}): { player: PlayerMovementState; distanceMeters: number } => {
    if (stepSeconds !== movementStepSeconds) {
        throw new RangeError('Movement requires the configured fixed stepSeconds.');
    }

    const canSprint = !player.isExhausted && player.stamina > 0;
    const isRunning = isMoving && isSprinting && !isSneaking && canSprint;
    const staminaChange = isRunning
        ? -movementSettings.staminaDrainPerSecond
        : movementSettings.staminaRecoveryPerSecond;
    const stamina = Math.min(1, Math.max(0, player.stamina + staminaChange * stepSeconds));
    const isExhausted =
        stamina === 0 || (player.isExhausted && stamina < movementSettings.sprintRecoveryThreshold);
    let speed: number = movementSettings.walkSpeedMetersPerSecond;
    let noiseRadiusMeters: number = movementSettings.walkNoiseRadiusMeters;

    if (isSneaking) {
        speed = movementSettings.sneakSpeedMetersPerSecond;
        noiseRadiusMeters = movementSettings.sneakNoiseRadiusMeters;
    } else if (isRunning) {
        speed = movementSettings.sprintSpeedMetersPerSecond;
        noiseRadiusMeters = movementSettings.sprintNoiseRadiusMeters;
    }

    return {
        player: {
            ...player,
            stamina,
            isExhausted,
            isSneaking,
            noiseRadiusMeters: isMoving ? noiseRadiusMeters : 0,
        },
        distanceMeters: speed * stepSeconds,
    };
};

export const stepPlayerToward = (
    player: PlayerMovementState,
    target: WorldPosition,
    stepSeconds: number,
    { isSprinting = false, isSneaking = false }: MovementModifiers = {},
): PlayerMovementState => {
    const dx = target.xMeters - player.position.xMeters;
    const dy = target.yMeters - player.position.yMeters;
    const distance = Math.hypot(dx, dy);
    const step = prepareStep({
        player,
        isMoving: distance > 0,
        isSprinting,
        isSneaking,
        stepSeconds,
    });

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
    { isSprinting = false, isSneaking = false }: MovementModifiers = {},
): PlayerMovementState => {
    const directionLength = Math.hypot(direction.x, direction.y);
    const step = prepareStep({
        player,
        isMoving: directionLength > 0,
        isSprinting,
        isSneaking,
        stepSeconds,
    });
    const movementScale = directionLength === 0 ? 0 : step.distanceMeters / directionLength;

    return {
        ...step.player,
        position: {
            xMeters: player.position.xMeters + direction.x * movementScale,
            yMeters: player.position.yMeters + direction.y * movementScale,
        },
    };
};
