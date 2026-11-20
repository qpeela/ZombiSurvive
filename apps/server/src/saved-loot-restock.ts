import type { GroundItem } from '@zombi-survive/domain';

const invalid = (): never => {
    throw new Error('Solo save contains invalid loot restock timers.');
};

export const readSavedRestocks = (
    value: unknown,
    points: readonly GroundItem[],
): ReadonlyMap<string, number> => {
    if (typeof value !== 'string') return invalid();
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return invalid();
    const known = new Set(
        points.filter(point => point.kind !== 'waterBottle').map(point => point.itemId),
    );
    const timers = new Map<string, number>();
    for (const entry of parsed as unknown[]) {
        if (!Array.isArray(entry) || entry.length !== 2) return invalid();
        const [pointId, deadline] = entry as unknown[];
        const isKnownPoint = typeof pointId === 'string' && known.has(pointId);
        const isValidDeadline =
            typeof deadline === 'number' && Number.isSafeInteger(deadline) && deadline >= 0;
        if (!isKnownPoint || !isValidDeadline || timers.has(pointId)) return invalid();
        timers.set(pointId, deadline);
    }
    return timers;
};

export const writeSavedRestocks = (
    timers: ReadonlyMap<string, number>,
    points: readonly GroundItem[],
): string => {
    const serialized = JSON.stringify([...timers].sort(([a], [b]) => a.localeCompare(b)));
    readSavedRestocks(serialized, points);
    return serialized;
};
