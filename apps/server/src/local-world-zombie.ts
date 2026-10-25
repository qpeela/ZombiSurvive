import { initialZombie, zombieSettings } from '@zombi-survive/content';
import type { WorldChunk, ZombieState } from '@zombi-survive/domain';
import {
    type MovementSnapshot,
    protocolVersion,
    type ZombieSnapshot,
    zombieVersion,
} from '@zombi-survive/protocol';
import { movementStepSeconds, stepZombie } from '@zombi-survive/simulation';
import { loadWorldChunks } from '@zombi-survive/worldgen';

export class LocalWorldZombie {
    private zombie: ZombieState = { ...initialZombie, position: { ...initialZombie.position } };
    private chunks: readonly WorldChunk[] = [];

    step(snapshots: ReadonlyMap<string, MovementSnapshot>): void {
        // One player may have multiple tabs; disconnected characters are absent.
        const players = [
            ...new Map(
                [...snapshots.values()].map(snapshot => [
                    snapshot.player.playerId,
                    snapshot.player,
                ]),
            ).values(),
        ];
        const activePlayers = players.filter(
            player =>
                Math.hypot(
                    player.position.xMeters - this.zombie.position.xMeters,
                    player.position.yMeters - this.zombie.position.yMeters,
                ) <= zombieSettings.pursuitRangeMeters,
        );

        if (activePlayers.length === 0) {
            this.chunks = [];
            this.zombie = { ...this.zombie, targetPlayerId: null };

            return;
        }

        this.chunks = loadWorldChunks({
            positions: [this.zombie.position, ...activePlayers.map(player => player.position)],
            previousChunks: this.chunks,
        });
        this.zombie = stepZombie({
            zombie: this.zombie,
            players: activePlayers,
            obstacles: this.chunks.flatMap(chunk => chunk.obstacles),
            stepSeconds: movementStepSeconds,
        });
    }

    snapshot(movement: MovementSnapshot): ZombieSnapshot {
        const distance = Math.hypot(
            movement.player.position.xMeters - this.zombie.position.xMeters,
            movement.player.position.yMeters - this.zombie.position.yMeters,
        );
        const isNearby =
            distance <= zombieSettings.pursuitRangeMeters + zombieSettings.navigationMarginMeters;

        return {
            type: 'zombie-state',
            protocolVersion,
            zombieVersion,
            worldId: movement.worldId,
            tick: movement.tick,
            zombies: isNearby ? [{ ...this.zombie, position: { ...this.zombie.position } }] : [],
        };
    }
}
