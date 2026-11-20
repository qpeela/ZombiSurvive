export type PlayerId = string;
export type WorldId = string;

export type WorldPosition = {
    readonly xMeters: number;
    readonly yMeters: number;
};

export type MovementModifiers = {
    readonly isSprinting?: boolean;
    readonly isSneaking?: boolean;
};

export type MovementAxis = -1 | 0 | 1;

export type MovementDirection = {
    readonly x: MovementAxis;
    readonly y: MovementAxis;
};

export type StaminaEffects = {
    readonly isRecoverySlowed: boolean;
    readonly isDrainIncreased: boolean;
    readonly maximumStamina?: number;
};

export type PlayerMovementState = {
    readonly playerId: PlayerId;
    readonly position: WorldPosition;
    /** Normalized reserve in [0, 1]. Only simulation changes it. */
    readonly stamina: number;
    /** Authoritative carried mass; absent in legacy snapshots means zero. */
    readonly carriedWeightGrams?: number;
    readonly staminaEffects?: StaminaEffects;
    readonly isExhausted: boolean;
    readonly isSneaking: boolean;
    /** Current movement noise radius; zero while idle. */
    readonly noiseRadiusMeters: number;
};
