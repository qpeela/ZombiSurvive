import type {
    MovementDirection,
    PlayerMovementState,
    WorldId,
    WorldPosition,
} from '@zombi-survive/domain';

export const protocolVersion = 4;
export const maxWorldPlayers = 8;

export type MovementInputCommand = {
    readonly type: 'movement-input';
    readonly protocolVersion: typeof protocolVersion;
    readonly sequence: number;
    readonly isSprinting: boolean;
    readonly direction: MovementDirection;
};

export type MovementTargetCommand = {
    readonly type: 'movement-target';
    readonly protocolVersion: typeof protocolVersion;
    readonly sequence: number;
    readonly isSprinting: boolean;
    readonly target: WorldPosition;
};

export const isMovementTargetCommand = (value: unknown): value is MovementTargetCommand => {
    if (!isRecord(value)) {
        return false;
    }

    const isSupportedType = value['type'] === 'movement-target';
    const isSupportedVersion = value['protocolVersion'] === protocolVersion;
    const isValidSequence = isSequence(value['sequence']);
    const isValidSprint = typeof value['isSprinting'] === 'boolean';
    const target = value['target'];

    if (
        !isSupportedType ||
        !isSupportedVersion ||
        !isValidSequence ||
        !isValidSprint ||
        !isRecord(target)
    ) {
        return false;
    }

    const isTargetCoordinate = (coordinate: unknown): boolean =>
        typeof coordinate === 'number' &&
        Number.isFinite(coordinate) &&
        Math.abs(coordinate) <= 1_000_000;

    return isTargetCoordinate(target['xMeters']) && isTargetCoordinate(target['yMeters']);
};

export type MovementSnapshot = {
    readonly type: 'movement-snapshot';
    readonly protocolVersion: typeof protocolVersion;
    readonly worldId: WorldId;
    readonly tick: number;
    readonly player: PlayerMovementState;
    readonly otherPlayers: readonly PlayerMovementState[];
    readonly lastProcessedInputSequence: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    const isObject = typeof value === 'object' && value !== null;

    return isObject && !Array.isArray(value);
};

const isAxis = (value: unknown): boolean => value === -1 || value === 0 || value === 1;

const isSequence = (value: unknown): boolean => {
    if (typeof value !== 'number') {
        return false;
    }

    const isSafeInteger = Number.isSafeInteger(value);
    const isPositive = value > 0;

    return isSafeInteger && isPositive;
};

const isId = (value: unknown): boolean => {
    if (typeof value !== 'string') {
        return false;
    }

    const isValidLength = value.length > 0 && value.length <= 128;
    const isTrimmed = value.trim() === value;

    return isValidLength && isTrimmed;
};

const isTick = (value: unknown): boolean => {
    if (typeof value !== 'number') {
        return false;
    }

    const isSafeInteger = Number.isSafeInteger(value);
    const isNonNegative = value >= 0;

    return isSafeInteger && isNonNegative;
};

const isCoordinate = (value: unknown): boolean => {
    if (typeof value !== 'number') {
        return false;
    }

    return Number.isFinite(value);
};

export const isMovementInputCommand = (value: unknown): value is MovementInputCommand => {
    if (!isRecord(value)) {
        return false;
    }

    const isSupportedType = value['type'] === 'movement-input';
    const isSupportedVersion = value['protocolVersion'] === protocolVersion;
    const isValidSequence = isSequence(value['sequence']);
    const isValidSprint = typeof value['isSprinting'] === 'boolean';
    const direction = value['direction'];

    if (
        !isSupportedType ||
        !isSupportedVersion ||
        !isValidSequence ||
        !isValidSprint ||
        !isRecord(direction)
    ) {
        return false;
    }

    const isValidX = isAxis(direction['x']);
    const isValidY = isAxis(direction['y']);

    return isValidX && isValidY;
};

const isPlayer = (value: unknown): value is PlayerMovementState => {
    if (!isRecord(value)) {
        return false;
    }

    if (!isId(value['playerId'])) {
        return false;
    }

    const stamina = value['stamina'];
    const isValidStamina =
        typeof stamina === 'number' && Number.isFinite(stamina) && stamina >= 0 && stamina <= 1;
    const isValidExhaustion = typeof value['isExhausted'] === 'boolean';

    if (!isValidStamina || !isValidExhaustion) {
        return false;
    }

    const position = value['position'];

    if (!isRecord(position)) {
        return false;
    }

    const isValidX = isCoordinate(position['xMeters']);
    const isValidY = isCoordinate(position['yMeters']);

    return isValidX && isValidY;
};

export const isMovementSnapshot = (value: unknown): value is MovementSnapshot => {
    if (!isRecord(value)) {
        return false;
    }

    const isSupportedType = value['type'] === 'movement-snapshot';
    const isSupportedVersion = value['protocolVersion'] === protocolVersion;
    const isValidTick = isTick(value['tick']);
    const isValidWorldId = isId(value['worldId']);
    const sequence = value['lastProcessedInputSequence'];
    const isValidAcknowledgement = sequence === null || isSequence(sequence);
    const player = value['player'];

    if (
        !isSupportedType ||
        !isSupportedVersion ||
        !isValidTick ||
        !isValidWorldId ||
        !isValidAcknowledgement ||
        !isPlayer(player)
    ) {
        return false;
    }

    const others = value['otherPlayers'];

    if (!Array.isArray(others) || others.length >= maxWorldPlayers) {
        return false;
    }

    const ids = new Set([player.playerId]);

    for (const other of others) {
        if (!isPlayer(other)) {
            return false;
        }

        if (ids.has(other.playerId)) {
            return false;
        }

        ids.add(other.playerId);
    }

    return true;
};
