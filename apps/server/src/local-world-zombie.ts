import { combatSettings, initialZombie, zombieSettings } from '@zombi-survive/content';
import type { WorldChunk, WorldObstacle, ZombieState } from '@zombi-survive/domain';
import {
    type MovementSnapshot,
    protocolVersion,
    type ZombieSnapshot,
    zombieSnapshotLimit,
    zombieVersion,
} from '@zombi-survive/protocol';
import { movementStepSeconds, stepZombie } from '@zombi-survive/simulation';
import { loadWorldChunks } from '@zombi-survive/worldgen';

export class LocalWorldZombie {
    private readonly zombies = new Map<string, ZombieState>([
        [initialZombie.zombieId, initialZombie],
    ]);
    private readonly health = new Map<string, number>();
    private readonly populatedChunks = new Set<string>();

    private chunks: readonly WorldChunk[] = [];

    damage(zombieId: string, amount: number): void {
        if (!this.zombies.has(zombieId)) return;

        const health = (this.health.get(zombieId) ?? combatSettings.zombieHealth) - amount;
        this.health.set(zombieId, health);

        if (health <= 0) this.zombies.delete(zombieId);
    }

    step(snapshots: ReadonlyMap<string, MovementSnapshot>): {
        zombies: readonly ZombieState[];
        obstacles: readonly WorldObstacle[];
    } {
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
        const obstacles = this.chunks.flatMap(chunk => chunk.obstacles);
        const activeZombies: ZombieState[] = [];
        for (const [id, zombie] of this.zombies) {
            const activePlayers = players.filter(
                player =>
                    Math.hypot(
                        player.position.xMeters - zombie.position.xMeters,
                        player.position.yMeters - zombie.position.yMeters,
                    ) <= zombieSettings.pursuitRangeMeters,
            );
            const next =
                activePlayers.length === 0
                    ? { ...zombie, targetPlayerId: null }
                    : stepZombie({
                          zombie,
                          players: activePlayers,
                          obstacles,
                          stepSeconds: movementStepSeconds,
                      });
            this.zombies.set(id, next);
            if (activePlayers.length > 0) activeZombies.push(next);
        }

        return { zombies: activeZombies, obstacles };
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
                ) <=
                zombieSettings.pursuitRangeMeters + zombieSettings.navigationMarginMeters,
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
