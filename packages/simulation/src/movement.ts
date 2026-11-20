import { hungerSettings, movementSettings, thirstSettings } from '@zombi-survive/content';
import type {
    MovementDirection,
    MovementModifiers,
    PlayerMovementState,
    WorldPosition,
} from '@zombi-survive/domain';

export const movementStepSeconds = 1 / movementSettings.ticksPerSecond;

export const sprintDrainMultiplier = (weightGrams: number, isDrainIncreased = false): number => {
    if (!Number.isSafeInteger(weightGrams) || weightGrams < 0)
        throw new RangeError('Carried weight must be a nonnegative integer.');

    const loadMultiplier = Math.min(
        movementSettings.maxLoadDrainMultiplier,
        1 + weightGrams / movementSettings.loadReferenceWeightGrams,
    );
    return isDrainIncreased ? loadMultiplier * thirstSettings.drainMultiplier : loadMultiplier;
};

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

    const {
        isRecoverySlowed = false,
        isDrainIncreased = false,
        maximumStamina = 1,
    } = player.staminaEffects ?? {};
    const availableStamina = Math.min(player.stamina, maximumStamina);
    const canSprint = !player.isExhausted && availableStamina > 0;
    const isRunning = isMoving && isSprinting && !isSneaking && canSprint;
    const recoveryMultiplier = isRecoverySlowed ? hungerSettings.recoveryMultiplier : 1;
    const staminaChange = isRunning
        ? -movementSettings.staminaDrainPerSecond *
          sprintDrainMultiplier(player.carriedWeightGrams ?? 0, isDrainIncreased)
        : movementSettings.staminaRecoveryPerSecond * recoveryMultiplier;
    const stamina = Math.min(
        maximumStamina,
        Math.max(0, availableStamina + staminaChange * stepSeconds),
    );
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
