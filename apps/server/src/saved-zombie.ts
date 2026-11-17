import { combatSettings, initialZombie, zombieSettings } from '@zombi-survive/content';
import type { WorldPosition } from '@zombi-survive/domain';

const invalid = (): never => {
    throw new Error('Solo save contains invalid zombie health.');
};

const isZombieId = (id: string): boolean => {
    if (id === initialZombie.zombieId) return true;
    const match = /^slow:(-?\d+),(-?\d+):(-?\d+),(-?\d+)$/.exec(id);
    if (match === null) return false;
    const [chunkX, chunkY, x, y] = match.slice(1).map(Number);
    if (
        chunkX === undefined ||
        chunkY === undefined ||
        x === undefined ||
        y === undefined ||
        !Number.isSafeInteger(chunkX) ||
        !Number.isSafeInteger(chunkY) ||
        !Number.isSafeInteger(x) ||
        !Number.isSafeInteger(y)
    )
        return false;
    if (id !== `slow:${String(chunkX)},${String(chunkY)}:${String(x)},${String(y)}`) return false;
    return (
        zombieSettings.spawnOffsetsMeters.includes(x) &&
        zombieSettings.spawnOffsetsMeters.includes(y) &&
        !(chunkX === 0 && chunkY === 0 && x === 0 && y === 0)
    );
};

export const readSavedZombies = (value: unknown): ReadonlyMap<string, number> => {
    if (typeof value !== 'string') return invalid();
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return invalid();
    const health = new Map<string, number>();
    for (const entry of parsed as unknown[]) {
        if (!Array.isArray(entry) || entry.length !== 2) return invalid();
        const record = entry as readonly unknown[];
        const id = record[0];
        const hp = record[1];
        if (
            typeof id !== 'string' ||
            !isZombieId(id) ||
            health.has(id) ||
            typeof hp !== 'number' ||
            !Number.isInteger(hp) ||
            hp < 0 ||
            hp >= combatSettings.zombieHealth
        )
            return invalid();
        health.set(id, hp);
    }
    return health;
};

export const writeSavedZombies = (health: ReadonlyMap<string, number>): string =>
    JSON.stringify(
        [...readSavedZombies(JSON.stringify([...health]))].sort(([a], [b]) => a.localeCompare(b)),
    );

export const readSavedZombiePositions = (value: unknown): ReadonlyMap<string, WorldPosition> => {
    if (typeof value !== 'string') throw new Error('Invalid saved zombie positions.');
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('Invalid saved zombie positions.');
    const positions = new Map<string, WorldPosition>();
    for (const entry of parsed as unknown[]) {
        if (!Array.isArray(entry) || entry.length !== 3)
            throw new Error('Invalid saved zombie positions.');
        const [id, xMeters, yMeters] = entry as unknown[];
        const isValidId = typeof id === 'string' && isZombieId(id);
        const isValidPosition =
            typeof xMeters === 'number' &&
            Number.isFinite(xMeters) &&
            typeof yMeters === 'number' &&
            Number.isFinite(yMeters) &&
            Math.abs(xMeters) <= 64_000_000 &&
            Math.abs(yMeters) <= 64_000_000;
        if (!isValidId || !isValidPosition || positions.has(id))
            throw new Error('Invalid saved zombie positions.');
        positions.set(id, { xMeters, yMeters });
    }
    return positions;
};

export const writeSavedZombiePositions = (
    positions: ReadonlyMap<string, WorldPosition>,
): string => {
    const serialized = JSON.stringify(
        [...positions]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, position]) => [id, position.xMeters, position.yMeters]),
    );
    readSavedZombiePositions(serialized);
    return serialized;
};
