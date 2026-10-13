export type PlayerId = string;
export type WorldId = string;

export type WorldPosition = {
    readonly xMeters: number;
    readonly yMeters: number;
};

export type MovementAxis = -1 | 0 | 1;

export type MovementDirection = {
    readonly x: MovementAxis;
    readonly y: MovementAxis;
};

export type PlayerMovementState = {
    readonly playerId: PlayerId;
    readonly position: WorldPosition;
};
