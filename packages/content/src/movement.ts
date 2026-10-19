// Initial prototype values; tune after movement is playable.
export const movementSettings = Object.freeze({
    ticksPerSecond: 20,
    walkSpeedMetersPerSecond: 4,
    sprintSpeedMetersPerSecond: 7,
    sneakSpeedMetersPerSecond: 2,
    walkNoiseRadiusMeters: 8,
    sprintNoiseRadiusMeters: 16,
    sneakNoiseRadiusMeters: 2,
    staminaDrainPerSecond: 0.2,
    staminaRecoveryPerSecond: 0.1,
    sprintRecoveryThreshold: 0.2,
});
