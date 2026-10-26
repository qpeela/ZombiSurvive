import { combatSettings } from '@zombi-survive/content';
import type { WorldObstacle, ZombieState } from '@zombi-survive/domain';
import {
    isMeleeCommand,
    type MeleeCommand,
    type MeleeSnapshot,
    meleeVersion,
    type MovementSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';
import { findMeleeTarget } from '@zombi-survive/simulation';

export class LocalWorldMelee {
    private readonly equipped = new Set<string>();
    private readonly nextAttackTick = new Map<string, number>();
    private readonly pending = new Map<string, MeleeCommand>();

    receive(sessionId: string, value: unknown): void {
        if (isMeleeCommand(value)) this.pending.set(sessionId, value);
    }
    leave(sessionId: string): void {
        this.pending.delete(sessionId);
    }
    step({
        snapshots,
        zombies,
        obstacles,
        damage,
        health,
    }: {
        snapshots: ReadonlyMap<string, MovementSnapshot>;
        zombies: readonly ZombieState[];
        obstacles: readonly WorldObstacle[];
        damage: (id: string) => void;
        health: (snapshot: MovementSnapshot) => number;
    }): void {
        for (const [sessionId, command] of this.pending) {
            const snapshot = snapshots.get(sessionId);
            if (snapshot === undefined || health(snapshot) <= 0) continue;

            const { player, tick } = snapshot;
            if (command.type === 'equip-club') {
                this.equipped.add(player.playerId);
                continue;
            }
            const isEquipped = this.equipped.has(player.playerId);
            const isReady = tick >= (this.nextAttackTick.get(player.playerId) ?? 0);
            if (!isEquipped || !isReady) continue;

            // A miss also consumes a swing; tabs share this cooldown.
            this.nextAttackTick.set(player.playerId, tick + combatSettings.meleeCooldownTicks);
            const target = findMeleeTarget({ position: player.position, zombies, obstacles });
            if (target !== undefined) damage(target.zombieId);
        }
        this.pending.clear();
    }
    snapshot(movement: MovementSnapshot): MeleeSnapshot {
        return {
            type: 'melee-state',
            protocolVersion,
            meleeVersion,
            worldId: movement.worldId,
            playerId: movement.player.playerId,
            tick: movement.tick,
            weapon: this.equipped.has(movement.player.playerId) ? 'club' : null,
        };
    }
}
