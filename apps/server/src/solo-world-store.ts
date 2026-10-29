import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
    collisionSettings,
    initialGroundItem,
    worldGenerationSettings,
} from '@zombi-survive/content';
import { isDisplayName, type ItemLocation, type WorldPosition } from '@zombi-survive/domain';
import { addStarterWeapons } from '@zombi-survive/simulation';
import { loadWorldChunks } from '@zombi-survive/worldgen';

import { readSavedItem, readSavedItems, writeSavedItems } from './saved-item.ts';

export type SavedSoloWorld = {
    readonly worldId: string;
    readonly playerId: string;
    readonly position: WorldPosition;
    readonly displayName: string;
    readonly nameRevision: number;
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
    readonly initialItemLocations: readonly ItemLocation[];
    private readonly database: DatabaseSync;
    private isClosed = false;
    private profile: { readonly displayName: string; readonly nameRevision: number };

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
            } else if (version !== 1 && version !== 2 && version !== 3 && version !== 4) {
                throw new Error('Unsupported solo save schema version.');
            }

            if (version === 0 || version === 1) {
                this.database.exec(`
                    ALTER TABLE solo_world ADD COLUMN display_name TEXT NOT NULL DEFAULT 'Выживший';
                    ALTER TABLE solo_world ADD COLUMN name_revision INTEGER NOT NULL DEFAULT 0;
                    PRAGMA user_version = 2;
                `);
            }

            if (version === 0 || version === 1 || version === 2) {
                this.database.exec(
                    "ALTER TABLE solo_world ADD COLUMN item_location TEXT NOT NULL DEFAULT '{}'",
                );
                this.database
                    .prepare('UPDATE solo_world SET item_location = ? WHERE id = 1')
                    .run(JSON.stringify({ type: 'ground', item: initialGroundItem }));
                this.database.exec('PRAGMA user_version = 3');
            }

            this.initialWorld = this.readWorld();
            const savedItems = this.database
                .prepare('SELECT item_location FROM solo_world WHERE id = 1')
                .get()?.['item_location'];

            if (version !== 4) {
                const bandage = readSavedItem(savedItems, this.initialWorld.playerId);
                const locations = addStarterWeapons([bandage], this.initialWorld.playerId);
                this.database
                    .prepare('UPDATE solo_world SET item_location = ? WHERE id = 1')
                    .run(writeSavedItems(locations, this.initialWorld.playerId));
                this.database.exec('PRAGMA user_version = 4');
            }

            this.initialItemLocations = readSavedItems(
                this.database.prepare('SELECT item_location FROM solo_world WHERE id = 1').get()?.[
                    'item_location'
                ],
                this.initialWorld.playerId,
            );
            this.profile = {
                displayName: this.initialWorld.displayName,
                nameRevision: this.initialWorld.nameRevision,
            };
            this.database.exec('COMMIT');
        } catch (error) {
            this.database.close();

            throw error;
        }
    }

    currentProfile(): { readonly displayName: string; readonly nameRevision: number } {
        return this.profile;
    }

    saveDisplayName(displayName: string): void {
        if (!isDisplayName(displayName)) {
            throw new Error('Invalid display name.');
        }

        if (displayName === this.profile.displayName) {
            return;
        }

        const nameRevision = this.profile.nameRevision + 1;

        if (!Number.isSafeInteger(nameRevision)) {
            throw new Error('Profile revision limit reached.');
        }

        this.database
            .prepare('UPDATE solo_world SET display_name = ?, name_revision = ? WHERE id = 1')
            .run(displayName, nameRevision);
        this.profile = { displayName, nameRevision };
    }

    savePosition(position: WorldPosition): void {
        // This state comes from authoritative movement; only load performs geometry validation.
        this.database
            .prepare('UPDATE solo_world SET x_meters = ?, y_meters = ? WHERE id = 1')
            .run(position.xMeters, position.yMeters);
    }

    saveItemLocations(locations: readonly ItemLocation[]): void {
        const saved = writeSavedItems(locations, this.initialWorld.playerId);
        // One UPDATE is an atomic, synchronous FULL commit of ground/owner/cell together.
        const result = this.database
            .prepare('UPDATE solo_world SET item_location = ? WHERE id = 1')
            .run(saved);

        if (Number(result.changes) !== 1) {
            throw new Error('Solo item save lost its world row.');
        }
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

        const displayName = saved['display_name'];
        const nameRevision = saved['name_revision'];
        const isRevision =
            typeof nameRevision === 'number' &&
            Number.isSafeInteger(nameRevision) &&
            nameRevision >= 0;

        if (!isDisplayName(displayName) || !isRevision) {
            throw new Error('Solo save contains an invalid profile.');
        }

        return { worldId, playerId, position, displayName, nameRevision };
    }
}
