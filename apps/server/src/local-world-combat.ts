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
    private attack: ZombieAttackState = { targetPlayerId: null, ticksUntilHit: 0 };

    step({
        zombie,
        snapshots,
        obstacles,
    }: {
        zombie: ZombieState;
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

        const target = [...snapshots.values()].find(
            snapshot => snapshot.player.playerId === zombie.targetPlayerId,
        )?.player;
        const result = stepZombieAttack({
            zombie,
            attack: this.attack,
            target,
            health: target === undefined ? undefined : this.players.get(target.playerId),
            obstacles,
        });
        this.attack = result.attack;

        if (result.health !== undefined) {
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
            health: this.players.get(movement.player.playerId)?.health ?? combatSettings.maxHealth,
            maxHealth: combatSettings.maxHealth,
        };
    }
}
