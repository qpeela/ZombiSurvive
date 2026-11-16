import { combatSettings, initialZombie, zombieSettings } from '@zombi-survive/content';

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
