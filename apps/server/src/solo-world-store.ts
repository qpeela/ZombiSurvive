import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
    collisionSettings,
    combatSettings,
    corpseSettings,
    initialGroundItem,
    worldGenerationSettings,
} from '@zombi-survive/content';
import {
    type Corpse,
    type GroundItem,
    isDisplayName,
    type ItemLocation,
    restockPointId,
    type WorldPosition,
} from '@zombi-survive/domain';
import { addStarterWeapons, expireCorpses } from '@zombi-survive/simulation';
import {
    initialExpandedLoot,
    initialWorldAmmoLoot,
    initialWorldPistolLoot,
    initialWorldWeaponLoot,
    loadWorldChunks,
} from '@zombi-survive/worldgen';

import {
    chunkLootForKey,
    chunkLootKeyFromItemId,
    readSavedLootChunks,
} from './saved-chunk-loot.ts';
import { readSavedCombat, type SavedCombat } from './saved-combat.ts';
import { readSavedCorpses } from './saved-corpse.ts';
import { readSavedItem, readSavedItems, writeSavedItems } from './saved-item.ts';
import { readSavedRestocks, writeSavedRestocks } from './saved-loot-restock.ts';
import { readSavedWorldTime, type SavedWorldProgress } from './saved-world-time.ts';
import {
    readSavedZombiePositions,
    readSavedZombies,
    writeSavedZombiePositions,
    writeSavedZombies,
} from './saved-zombie.ts';

const pistolManifest = [...initialWorldWeaponLoot, ...initialWorldPistolLoot];
const ammoManifest = [...pistolManifest, ...initialWorldAmmoLoot];
const worldItemManifest = [...ammoManifest, ...initialExpandedLoot];

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
    readonly initialWorldTimeMs: number;
    readonly initialLootRestocks: ReadonlyMap<string, number>;
    readonly initialItemLocations: readonly ItemLocation[];
    readonly initialCombat: SavedCombat;
    readonly initialCorpses: readonly Corpse[];
    readonly initialZombieHealth: ReadonlyMap<string, number>;
    readonly initialZombiePositions: ReadonlyMap<string, WorldPosition>;
    private readonly database: DatabaseSync;
    private isClosed = false;
    private lootChunks: readonly string[] = [];
    private worldLoot: readonly GroundItem[] = worldItemManifest;
    private profile: { readonly displayName: string; readonly nameRevision: number };

    constructor(path: string, now: () => number = Date.now) {
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
            } else if (
                version !== 1 &&
                version !== 2 &&
                version !== 3 &&
                version !== 4 &&
                version !== 5 &&
                version !== 6 &&
                version !== 7 &&
                version !== 8 &&
                version !== 9 &&
                version !== 10 &&
                version !== 11 &&
                version !== 12 &&
                version !== 13 &&
                version !== 14 &&
                version !== 15 &&
                version !== 16 &&
                version !== 17 &&
                version !== 18 &&
                version !== 19
            ) {
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

            if (typeof version === 'number' && version < 4) {
                const bandage = readSavedItem(savedItems, this.initialWorld.playerId);
                const locations = addStarterWeapons([bandage], this.initialWorld.playerId);
                this.database
                    .prepare('UPDATE solo_world SET item_location = ? WHERE id = 1')
                    .run(writeSavedItems(locations, this.initialWorld.playerId));
                this.database.exec('PRAGMA user_version = 4');
            }

            if (typeof version === 'number' && version < 5) {
                const oldLocations = readSavedItems(
                    this.database
                        .prepare('SELECT item_location FROM solo_world WHERE id = 1')
                        .get()?.['item_location'],
                    this.initialWorld.playerId,
                );
                const locations: readonly ItemLocation[] = [
                    ...oldLocations,
                    ...initialWorldWeaponLoot.map(item => ({ type: 'ground' as const, item })),
                ];
                this.database
                    .prepare('UPDATE solo_world SET item_location = ? WHERE id = 1')
                    .run(
                        writeSavedItems(
                            locations,
                            this.initialWorld.playerId,
                            initialWorldWeaponLoot,
                        ),
                    );
                this.database.exec('PRAGMA user_version = 5');
            }

            if (typeof version === 'number' && version >= 13) {
                this.lootChunks = readSavedLootChunks(
                    this.database
                        .prepare('SELECT loot_chunks FROM solo_world WHERE id = 1')
                        .get()?.['loot_chunks'],
                );
                this.worldLoot = [
                    ...worldItemManifest,
                    ...this.lootChunks.flatMap(key => chunkLootForKey(key, version >= 19)),
                ];
            }
            const priorManifest = version === 10 ? pistolManifest : ammoManifest;
            const firearmManifest =
                typeof version === 'number' && version >= 12 ? this.worldLoot : priorManifest;
            this.initialItemLocations = readSavedItems(
                this.database.prepare('SELECT item_location FROM solo_world WHERE id = 1').get()?.[
                    'item_location'
                ],
                this.initialWorld.playerId,
                typeof version === 'number' && version >= 10
                    ? firearmManifest
                    : initialWorldWeaponLoot,
                typeof version === 'number' && version >= 8,
            );
            if (typeof version === 'number' && version < 12) {
                this.initialItemLocations = [
                    ...this.initialItemLocations,
                    ...(version < 10 ? initialWorldPistolLoot : []).map(item => ({
                        type: 'ground' as const,
                        item,
                    })),
                    ...(version < 11 ? initialWorldAmmoLoot : []).map(item => ({
                        type: 'ground' as const,
                        item,
                    })),
                    ...initialExpandedLoot.map(item => ({ type: 'ground' as const, item })),
                ];
                this.database
                    .prepare('UPDATE solo_world SET item_location = ? WHERE id = 1')
                    .run(
                        writeSavedItems(
                            this.initialItemLocations,
                            this.initialWorld.playerId,
                            worldItemManifest,
                        ),
                    );
            }
            if (typeof version === 'number' && version < 13) {
                this.database.exec(
                    "ALTER TABLE solo_world ADD COLUMN loot_chunks TEXT NOT NULL DEFAULT '[]'",
                );
            }
            if (typeof version === 'number' && version < 6) {
                this.database.exec(`
                    ALTER TABLE solo_world ADD COLUMN combat_state TEXT NOT NULL
                        DEFAULT '{"health":100,"cooldownTicks":0}';
                    PRAGMA user_version = 6;
                `);
            }

            if (typeof version === 'number' && version < 7) {
                const legacy = readSavedCombat(
                    this.database
                        .prepare('SELECT combat_state FROM solo_world WHERE id = 1')
                        .get()?.['combat_state'],
                    true,
                );
                this.database
                    .prepare('UPDATE solo_world SET combat_state = ? WHERE id = 1')
                    .run(JSON.stringify(legacy));
                this.database.exec('PRAGMA user_version = 7');
            }

            this.initialCombat = readSavedCombat(
                this.database.prepare('SELECT combat_state FROM solo_world WHERE id = 1').get()?.[
                    'combat_state'
                ],
            );
            if (typeof version === 'number' && version < 14) {
                const hasZombieHealth = this.database
                    .prepare('PRAGMA table_info(solo_world)')
                    .all()
                    .some(column => column['name'] === 'zombie_health');
                if (!hasZombieHealth)
                    this.database.exec(
                        "ALTER TABLE solo_world ADD COLUMN zombie_health TEXT NOT NULL DEFAULT '[]'",
                    );
            }
            this.initialZombieHealth = readSavedZombies(
                this.database.prepare('SELECT zombie_health FROM solo_world WHERE id = 1').get()?.[
                    'zombie_health'
                ],
            );
            if (typeof version === 'number' && version < 15) {
                const hasPositions = this.database
                    .prepare('PRAGMA table_info(solo_world)')
                    .all()
                    .some(column => column['name'] === 'zombie_positions');
                if (!hasPositions)
                    this.database.exec(
                        "ALTER TABLE solo_world ADD COLUMN zombie_positions TEXT NOT NULL DEFAULT '[]'",
                    );
            }
            this.initialZombiePositions = readSavedZombiePositions(
                this.database
                    .prepare('SELECT zombie_positions FROM solo_world WHERE id = 1')
                    .get()?.['zombie_positions'],
            );
            if (typeof version === 'number' && version < 16) {
                const hasWorldTime = this.database
                    .prepare('PRAGMA table_info(solo_world)')
                    .all()
                    .some(column => column['name'] === 'world_time_ms');
                if (!hasWorldTime)
                    this.database.exec(
                        'ALTER TABLE solo_world ADD COLUMN world_time_ms INTEGER NOT NULL DEFAULT 0',
                    );
            }
            this.initialWorldTimeMs = readSavedWorldTime(
                this.database.prepare('SELECT world_time_ms FROM solo_world WHERE id = 1').get()?.[
                    'world_time_ms'
                ],
            );
            // v8 permits only the bandage to be absent. Legacy manifests were validated above.
            if (typeof version === 'number' && version < 9) {
                this.database.exec(
                    "ALTER TABLE solo_world ADD COLUMN corpses TEXT NOT NULL DEFAULT '[]'",
                );
                if (this.initialCombat.health === 0) {
                    const diedAtMs = now();
                    const corpse: Corpse = {
                        corpseId: randomUUID(),
                        playerId: this.initialWorld.playerId,
                        position: this.initialWorld.position,
                        diedAtMs,
                        expiresAtMs: diedAtMs + corpseSettings.lifetimeMs,
                    };
                    this.initialItemLocations = this.initialItemLocations.map(location =>
                        location.type === 'container' || location.type === 'hands'
                            ? {
                                  type: 'corpse',
                                  corpseId: corpse.corpseId,
                                  item: { ...location.item },
                              }
                            : location,
                    );
                    this.database
                        .prepare(
                            'UPDATE solo_world SET corpses = ?, item_location = ? WHERE id = 1',
                        )
                        .run(
                            JSON.stringify([corpse]),
                            writeSavedItems(
                                this.initialItemLocations,
                                this.initialWorld.playerId,
                                this.worldLoot,
                            ),
                        );
                }
                this.database.exec('PRAGMA user_version = 9');
            }
            const savedCorpses = this.database
                .prepare('SELECT corpses FROM solo_world WHERE id = 1')
                .get()?.['corpses'];
            this.initialCorpses = readSavedCorpses(savedCorpses, this.initialItemLocations);
            const expiry = expireCorpses({
                corpses: this.initialCorpses,
                locations: this.initialItemLocations,
                nowMs: now(),
            });
            if (expiry !== null) {
                this.initialCorpses = expiry.corpses;
                this.initialItemLocations = expiry.locations;
            }
            const normalizedCorpses = JSON.stringify(this.initialCorpses);
            if (expiry !== null || normalizedCorpses !== savedCorpses) {
                this.database
                    .prepare('UPDATE solo_world SET corpses = ?, item_location = ? WHERE id = 1')
                    .run(
                        normalizedCorpses,
                        writeSavedItems(
                            this.initialItemLocations,
                            this.initialWorld.playerId,
                            this.worldLoot,
                        ),
                    );
            }
            if (typeof version === 'number' && version < 17) {
                const hasRestocks = this.database
                    .prepare('PRAGMA table_info(solo_world)')
                    .all()
                    .some(column => column['name'] === 'loot_restocks');
                if (!hasRestocks)
                    this.database.exec(
                        "ALTER TABLE solo_world ADD COLUMN loot_restocks TEXT NOT NULL DEFAULT '[]'",
                    );
            }
            this.initialLootRestocks = readSavedRestocks(
                this.database.prepare('SELECT loot_restocks FROM solo_world WHERE id = 1').get()?.[
                    'loot_restocks'
                ],
                this.lootPoints(),
            );
            if (typeof version === 'number' && version < 19) {
                const additions = this.lootChunks.flatMap(key =>
                    chunkLootForKey(key).filter(item => item.kind === 'bandage'),
                );
                this.worldLoot = [...this.worldLoot, ...additions];
                this.initialItemLocations = [
                    ...this.initialItemLocations,
                    ...additions.map(item => ({ type: 'ground' as const, item })),
                ];
                this.database
                    .prepare('UPDATE solo_world SET item_location = ? WHERE id = 1')
                    .run(
                        writeSavedItems(
                            this.initialItemLocations,
                            this.initialWorld.playerId,
                            this.worldLoot,
                        ),
                    );
            }
            if (version !== 19) this.database.exec('PRAGMA user_version = 19');
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

    savePosition(position: WorldPosition, worldTimeMs?: number): void {
        // This state comes from authoritative movement; only load performs geometry validation.
        this.database
            .prepare(
                'UPDATE solo_world SET x_meters = ?, y_meters = ?, world_time_ms = COALESCE(?, world_time_ms) WHERE id = 1',
            )
            .run(
                position.xMeters,
                position.yMeters,
                worldTimeMs === undefined ? null : readSavedWorldTime(worldTimeMs),
            );
    }

    lootPoints(): readonly GroundItem[] {
        return [initialGroundItem, ...this.worldLoot];
    }

    saveItemLocations(locations: readonly ItemLocation[], progress?: SavedWorldProgress): void {
        const saved = this.prepareItems(locations);
        // One UPDATE is an atomic, synchronous FULL commit of ground/owner/cell together.
        const result = this.database
            .prepare(
                'UPDATE solo_world SET item_location = ?, loot_chunks = ?, world_time_ms = COALESCE(?, world_time_ms), loot_restocks = COALESCE(?, loot_restocks) WHERE id = 1',
            )
            .run(
                saved.items,
                JSON.stringify(saved.chunks),
                progress === undefined ? null : readSavedWorldTime(progress.worldTimeMs),
                progress?.restocks === undefined
                    ? null
                    : writeSavedRestocks(progress.restocks, [initialGroundItem, ...saved.manifest]),
            );

        if (Number(result.changes) !== 1) {
            throw new Error('Solo item save lost its world row.');
        }
        this.lootChunks = saved.chunks;
        this.worldLoot = saved.manifest;
    }

    saveCombat(
        state: SavedCombat,
        locations?: readonly ItemLocation[],
        position?: WorldPosition,
        corpses?: readonly Corpse[],
        zombieHealth?: ReadonlyMap<string, number>,
        zombiePositions?: ReadonlyMap<string, WorldPosition>,
        progress?: SavedWorldProgress,
    ): void {
        const saved = JSON.stringify(readSavedCombat(JSON.stringify(state)));
        const items = locations === undefined ? undefined : this.prepareItems(locations);
        // Death, its final position and simultaneous items share one FULL commit.
        const assignments = ['combat_state = ?'];
        const values: (string | number)[] = [saved];

        if (items !== undefined) {
            assignments.push('item_location = ?', 'loot_chunks = ?');
            values.push(items.items, JSON.stringify(items.chunks));
        }

        if (corpses !== undefined) {
            const checked = readSavedCorpses(
                JSON.stringify(corpses),
                locations ?? this.initialItemLocations,
            );
            assignments.push('corpses = ?');
            values.push(JSON.stringify(checked));
        }

        if (position !== undefined) {
            assignments.push('x_meters = ?', 'y_meters = ?');
            values.push(position.xMeters, position.yMeters);
        }

        if (zombieHealth !== undefined) {
            assignments.push('zombie_health = ?');
            values.push(writeSavedZombies(zombieHealth));
        }

        if (zombiePositions !== undefined) {
            assignments.push('zombie_positions = ?');
            values.push(writeSavedZombiePositions(zombiePositions));
        }

        if (progress !== undefined) {
            assignments.push('world_time_ms = ?');
            values.push(readSavedWorldTime(progress.worldTimeMs));
            if (progress.restocks !== undefined) {
                assignments.push('loot_restocks = ?');
                values.push(
                    writeSavedRestocks(progress.restocks, [
                        initialGroundItem,
                        ...(items?.manifest ?? this.worldLoot),
                    ]),
                );
            }
        }

        const result = this.database
            .prepare(`UPDATE solo_world SET ${assignments.join(', ')} WHERE id = 1`)
            .run(...values);

        if (Number(result.changes) !== 1) {
            throw new Error('Solo combat save lost its world row.');
        }
        if (items !== undefined) {
            this.lootChunks = items.chunks;
            this.worldLoot = items.manifest;
        }
    }

    saveRespawn(expectedLifeRevision: number, position: WorldPosition): SavedCombat {
        validatePosition(position);
        const current = readSavedCombat(
            this.database.prepare('SELECT combat_state FROM solo_world WHERE id = 1').get()?.[
                'combat_state'
            ],
        );
        if (current.health !== 0 || (current.lifeRevision ?? 0) !== expectedLifeRevision)
            throw new Error('Respawn belongs to an obsolete or living player.');
        const lifeRevision = expectedLifeRevision + 1;
        if (!Number.isSafeInteger(lifeRevision)) throw new Error('Life revision limit reached.');
        const locations = readSavedItems(
            this.database.prepare('SELECT item_location FROM solo_world WHERE id = 1').get()?.[
                'item_location'
            ],
            this.initialWorld.playerId,
            this.worldLoot,
            true,
        );
        if (locations.some(location => location.type === 'container' || location.type === 'hands'))
            throw new Error('Dead player still owns items.');
        const next = {
            health: combatSettings.maxHealth,
            cooldownTicks: 0,
            bleedingTicks: 0,
            lifeRevision,
        };
        this.saveCombat(next, undefined, position);
        return next;
    }

    close(): void {
        if (!this.isClosed) {
            this.database.close();
            this.isClosed = true;
        }
    }

    private prepareItems(locations: readonly ItemLocation[]): {
        readonly items: string;
        readonly chunks: readonly string[];
        readonly manifest: readonly GroundItem[];
    } {
        const known = new Set(this.lootChunks);
        const additions: string[] = [];
        for (const location of locations) {
            const key = chunkLootKeyFromItemId(
                restockPointId(location.item.itemId) ?? location.item.itemId,
            );
            if (key !== null && !known.has(key)) {
                known.add(key);
                additions.push(key);
            }
        }
        const chunks = additions.length === 0 ? this.lootChunks : [...known].sort();
        const manifest =
            additions.length === 0
                ? this.worldLoot
                : [...this.worldLoot, ...additions.flatMap(key => chunkLootForKey(key))];
        const items = writeSavedItems(locations, this.initialWorld.playerId, manifest);

        return { items, chunks, manifest };
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
