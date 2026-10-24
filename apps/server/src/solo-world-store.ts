import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { collisionSettings, worldGenerationSettings } from '@zombi-survive/content';
import type { WorldPosition } from '@zombi-survive/domain';
import { loadWorldChunks } from '@zombi-survive/worldgen';

export type SavedSoloWorld = {
    readonly worldId: string;
    readonly playerId: string;
    readonly position: WorldPosition;
};

const validatePosition = (position: WorldPosition): void => {
    const { xMeters, yMeters } = position;

    if (!Number.isFinite(xMeters) || !Number.isFinite(yMeters)) {
        throw new Error('Solo save contains an invalid position.');
    }

    const chunks = loadWorldChunks({ positions: [position], previousChunks: [] });
    const half = collisionSettings.playerHalfSizeMeters;
    const isBlocked = chunks.some(chunk =>
        chunk.obstacles.some(obstacle => {
            const isOverlappingX =
                xMeters > obstacle.minXMeters - half && xMeters < obstacle.maxXMeters + half;
            const isOverlappingY =
                yMeters > obstacle.minYMeters - half && yMeters < obstacle.maxYMeters + half;

            return isOverlappingX && isOverlappingY;
        }),
    );

    if (isBlocked) {
        throw new Error('Solo save position overlaps an obstacle.');
    }
};

/** One host owns this connection. Transactions run outside the simulation step. */
export class SoloWorldStore {
    readonly initialWorld: SavedSoloWorld;
    private readonly database: DatabaseSync;
    private isClosed = false;

    constructor(path: string) {
        if (!isAbsolute(path)) {
            throw new Error('WORLD_SAVE_PATH must be an absolute file path.');
        }

        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.database = new DatabaseSync(path);

        try {
            chmodSync(path, 0o600);
            // Keep the file lock between commits; a second host must not load stale state.
            this.database.exec(`
                PRAGMA locking_mode = EXCLUSIVE;
                PRAGMA journal_mode = DELETE;
                PRAGMA synchronous = FULL;
                BEGIN EXCLUSIVE;
            `);
            const version = this.database.prepare('PRAGMA user_version').get()?.['user_version'];

            if (version === 0) {
                const tables = this.database
                    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
                    .all();

                if (tables.length !== 0) {
                    throw new Error('Unversioned solo save is not an empty database.');
                }

                this.database.exec(`
                    CREATE TABLE solo_world (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        world_id TEXT NOT NULL,
                        player_id TEXT NOT NULL,
                        seed TEXT NOT NULL,
                        generator_version INTEGER NOT NULL,
                        x_meters REAL NOT NULL,
                        y_meters REAL NOT NULL
                    ) STRICT;
                    PRAGMA user_version = 1;
                `);
                this.database
                    .prepare('INSERT INTO solo_world VALUES (1, ?, ?, ?, ?, 0, 0)')
                    .run(
                        randomUUID(),
                        randomUUID(),
                        worldGenerationSettings.initialSeed,
                        worldGenerationSettings.generatorVersion,
                    );
            } else if (version !== 1) {
                throw new Error('Unsupported solo save schema version.');
            }

            this.initialWorld = this.readWorld();
            this.database.exec('COMMIT');
        } catch (error) {
            this.database.close();

            throw error;
        }
    }

    savePosition(position: WorldPosition): void {
        // This state comes from authoritative movement; only load performs geometry validation.
        this.database
            .prepare('UPDATE solo_world SET x_meters = ?, y_meters = ? WHERE id = 1')
            .run(position.xMeters, position.yMeters);
    }

    close(): void {
        if (!this.isClosed) {
            this.database.close();
            this.isClosed = true;
        }
    }

    private readWorld(): SavedSoloWorld {
        const row = this.database.prepare('SELECT * FROM solo_world').all();
        const saved = row[0];

        if (row.length !== 1 || saved === undefined || saved['id'] !== 1) {
            throw new Error('Solo save must contain exactly one world.');
        }

        const isMatchingGenerator =
            saved['seed'] === worldGenerationSettings.initialSeed &&
            saved['generator_version'] === worldGenerationSettings.generatorVersion;

        if (!isMatchingGenerator) {
            throw new Error('Solo save uses an incompatible world generator.');
        }

        const worldId = saved['world_id'];
        const playerId = saved['player_id'];
        const xMeters = saved['x_meters'];
        const yMeters = saved['y_meters'];
        const isIdentifier = (value: unknown): value is string =>
            typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
        const isNumericPosition = typeof xMeters === 'number' && typeof yMeters === 'number';

        if (!isIdentifier(worldId) || !isIdentifier(playerId) || !isNumericPosition) {
            throw new Error('Solo save contains invalid world data.');
        }

        const position = { xMeters, yMeters };
        validatePosition(position);

        return { worldId, playerId, position };
    }
}
