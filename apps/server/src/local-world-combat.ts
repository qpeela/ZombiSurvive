import { combatSettings } from '@zombi-survive/content';
import type {
    PlayerHealth,
    WorldObstacle,
    ZombieAttackState,
    ZombieState,
} from '@zombi-survive/domain';
import {
    type HealthSnapshot,
    healthVersion,
    type MovementSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';
import { stepZombieAttack } from '@zombi-survive/simulation';

export class LocalWorldCombat {
    private readonly players = new Map<string, PlayerHealth>();
    private readonly attacks = new Map<string, ZombieAttackState>();

    constructor(initialHealth?: PlayerHealth) {
        if (initialHealth !== undefined)
            this.players.set(initialHealth.playerId, { ...initialHealth });
    }

    health(playerId: string): number {
        return this.players.get(playerId)?.health ?? combatSettings.maxHealth;
    }

    step({
        zombies,
        snapshots,
        obstacles,
    }: {
        zombies: readonly ZombieState[];
        snapshots: ReadonlyMap<string, MovementSnapshot>;
        obstacles: readonly WorldObstacle[];
    }): void {
        for (const { player } of snapshots.values()) {
            if (!this.players.has(player.playerId)) {
                this.players.set(player.playerId, {
                    playerId: player.playerId,
                    health: combatSettings.maxHealth,
                });
            }
        }

        const ids = new Set(zombies.map(zombie => zombie.zombieId));
        for (const id of this.attacks.keys()) {
            if (!ids.has(id)) this.attacks.delete(id);
        }
        for (const zombie of zombies) {
            const target = [...snapshots.values()].find(
                snapshot => snapshot.player.playerId === zombie.targetPlayerId,
            )?.player;
            const result = stepZombieAttack({
                zombie,
                attack: this.attacks.get(zombie.zombieId) ?? {
                    targetPlayerId: null,
                    ticksUntilHit: 0,
                },
                target,
                health: target === undefined ? undefined : this.players.get(target.playerId),
                obstacles,
            });
            this.attacks.set(zombie.zombieId, result.attack);
            if (result.health !== undefined)
                this.players.set(result.health.playerId, result.health);
        }
    }

    snapshot(movement: MovementSnapshot): HealthSnapshot {
        return {
            type: 'health-state',
            protocolVersion,
            healthVersion,
            worldId: movement.worldId,
            playerId: movement.player.playerId,
            tick: movement.tick,
            health: this.health(movement.player.playerId),
            maxHealth: combatSettings.maxHealth,
        };
    }
}
