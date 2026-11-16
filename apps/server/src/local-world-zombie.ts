import { combatSettings, initialZombie, zombieSettings } from '@zombi-survive/content';
import type { WorldChunk, WorldObstacle, WorldPosition, ZombieState } from '@zombi-survive/domain';
import {
    type MovementSnapshot,
    protocolVersion,
    type ShotAction,
    type ZombieSnapshot,
    zombieSnapshotLimit,
    zombieVersion,
} from '@zombi-survive/protocol';
import {
    type HeardGunshot,
    hearGunshot,
    movementStepSeconds,
    stepGunshotInvestigation,
    stepZombie,
} from '@zombi-survive/simulation';
import { loadWorldChunks } from '@zombi-survive/worldgen';

export class LocalWorldZombie {
    private readonly zombies: Map<string, ZombieState>;
    private readonly health: Map<string, number>;
    private isHealthDirty = false;
    private readonly heard = new Map<string, HeardGunshot>();
    private readonly latestShotRevision = new Map<string, number>();
    private tick = 0;
    private readonly populatedChunks = new Set<string>();

    private chunks: readonly WorldChunk[] = [];

    constructor(savedHealth: ReadonlyMap<string, number> = new Map()) {
        this.health = new Map(savedHealth);
        this.zombies = new Map(
            this.health.get(initialZombie.zombieId) === 0
                ? []
                : [[initialZombie.zombieId, initialZombie]],
        );
    }

    damage(zombieId: string, amount: number): { damage: number; isKilled: boolean } | null {
        if (!this.zombies.has(zombieId)) return null;

        const previousHealth = this.health.get(zombieId) ?? combatSettings.zombieHealth;
        const health = Math.max(0, previousHealth - amount);
        this.health.set(zombieId, health);
        this.isHealthDirty = true;

        if (health <= 0) {
            this.zombies.delete(zombieId);
            this.heard.delete(zombieId);
        }

        return { damage: Math.min(previousHealth, amount), isKilled: health <= 0 };
    }

    pendingHealthSave(): ReadonlyMap<string, number> | null {
        return this.isHealthDirty ? new Map(this.health) : null;
    }

    confirmHealthSave(): void {
        this.isHealthDirty = false;
    }

    private isLoaded(position: WorldPosition): boolean {
        return this.chunks.some(chunk => {
            const half = chunk.sizeMeters / 2;
            return (
                position.xMeters >= chunk.chunkX * chunk.sizeMeters - half &&
                position.xMeters < chunk.chunkX * chunk.sizeMeters + half &&
                position.yMeters >= chunk.chunkY * chunk.sizeMeters - half &&
                position.yMeters < chunk.chunkY * chunk.sizeMeters + half
            );
        });
    }

    hearShot(action: ShotAction): void {
        const previous = this.latestShotRevision.get(action.itemId) ?? 0;
        if (action.weaponRevision <= previous || action.tick > this.tick) return;
        this.latestShotRevision.set(action.itemId, action.weaponRevision);
        for (const zombie of this.zombies.values()) {
            if (!this.isLoaded(zombie.position)) continue;
            const heard = hearGunshot({
                position: zombie.position,
                origin: action.origin,
                shotTick: action.tick,
                tick: this.tick,
            });
            if (heard !== null) this.heard.set(zombie.zombieId, heard);
        }
    }

    step(
        snapshots: ReadonlyMap<string, MovementSnapshot>,
        isLiving: (playerId: string) => boolean = () => true,
    ): {
        zombies: readonly ZombieState[];
        obstacles: readonly WorldObstacle[];
    } {
        this.tick++;
        // One player may have multiple tabs; disconnected characters are absent.
        const players = [
            ...new Map(
                [...snapshots.values()].map(snapshot => [
                    snapshot.player.playerId,
                    snapshot.player,
                ]),
            ).values(),
        ];
        this.chunks = loadWorldChunks({
            positions: players.map(player => player.position),
            previousChunks: this.chunks,
        });
        for (const chunk of this.chunks) {
            const key = `${String(chunk.chunkX)},${String(chunk.chunkY)}`;
            if (this.populatedChunks.has(key)) continue;

            this.populatedChunks.add(key);
            for (const x of zombieSettings.spawnOffsetsMeters) {
                for (const y of zombieSettings.spawnOffsetsMeters) {
                    const isCenter = x === 0 && y === 0;
                    const isStartingZombie = isCenter && chunk.chunkX === 0 && chunk.chunkY === 0;
                    if (isStartingZombie) continue;

                    const zombieId = `slow:${key}:${String(x)},${String(y)}`;
                    if (this.health.get(zombieId) === 0) continue;
                    this.zombies.set(zombieId, {
                        zombieId,
                        position: {
                            xMeters:
                                chunk.chunkX * chunk.sizeMeters +
                                (isCenter ? initialZombie.position.xMeters : x),
                            yMeters: chunk.chunkY * chunk.sizeMeters + y,
                        },
                        targetPlayerId: null,
                    });
                }
            }
        }
        const living = players.filter(player => isLiving(player.playerId));
        const obstacles = this.chunks.flatMap(chunk => chunk.obstacles);
        const activeZombies: ZombieState[] = [];
        for (const [id, zombie] of this.zombies) {
            if (!this.isLoaded(zombie.position)) {
                this.heard.delete(id);
                this.zombies.set(id, { ...zombie, targetPlayerId: null });
                continue;
            }
            let heard = this.heard.get(id);
            if (heard !== undefined && heard.expiresAtTick <= this.tick) {
                this.heard.delete(id);
                heard = undefined;
            }
            const activePlayers = living.filter(
                player =>
                    Math.hypot(
                        player.position.xMeters - zombie.position.xMeters,
                        player.position.yMeters - zombie.position.yMeters,
                    ) <= zombieSettings.pursuitRangeMeters,
            );
            let next =
                activePlayers.length === 0
                    ? { ...zombie, targetPlayerId: null }
                    : stepZombie({
                          zombie,
                          players: activePlayers,
                          obstacles,
                          stepSeconds: movementStepSeconds,
                      });
            if (next.targetPlayerId === null && heard !== undefined)
                next = stepGunshotInvestigation({
                    zombie: next,
                    heard,
                    tick: this.tick,
                    obstacles,
                    stepSeconds: movementStepSeconds,
                });
            this.zombies.set(id, next);
            if (activePlayers.length > 0 || heard !== undefined) activeZombies.push(next);
        }

        return { zombies: activeZombies, obstacles };
    }

    shotTargets(): readonly ZombieState[] {
        return [...this.zombies.values()];
    }

    spawnBlockers(): readonly { readonly xMeters: number; readonly yMeters: number }[] {
        return [...this.zombies.values()].map(zombie => ({ ...zombie.position }));
    }

    isAlive(id: string): boolean {
        return this.zombies.has(id);
    }

    snapshot(movement: MovementSnapshot): ZombieSnapshot {
        const nearby = [...this.zombies.values()].filter(
            zombie =>
                Math.hypot(
                    movement.player.position.xMeters - zombie.position.xMeters,
                    movement.player.position.yMeters - zombie.position.yMeters,
                ) <= zombieSettings.visibilityRangeMeters,
        );

        return {
            type: 'zombie-state',
            protocolVersion,
            zombieVersion,
            worldId: movement.worldId,
            tick: movement.tick,
            zombies: nearby
                .slice(0, zombieSnapshotLimit)
                .map(zombie => ({ ...zombie, position: { ...zombie.position } })),
        };
    }
}
