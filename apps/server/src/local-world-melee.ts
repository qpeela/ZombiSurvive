import { meleeWeapons } from '@zombi-survive/content';
import type { MeleeWeaponId, WorldObstacle, ZombieState } from '@zombi-survive/domain';
import {
    isMeleeCommand,
    type MeleeAction,
    type MeleeCommand,
    type MeleeImpact,
    type MeleeSnapshot,
    meleeVersion,
    type MovementSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';
import { findMeleeTarget } from '@zombi-survive/simulation';

export class LocalWorldMelee {
    private readonly actions = new Map<string, MeleeAction>();
    private readonly equipped = new Map<string, MeleeWeaponId>();
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
        damage: (id: string, amount: number) => { damage: number; isKilled: boolean } | null;
        health: (snapshot: MovementSnapshot) => number;
    }): void {
        this.actions.clear();

        for (const [sessionId, command] of this.pending) {
            const snapshot = snapshots.get(sessionId);
            if (snapshot === undefined || health(snapshot) <= 0) continue;

            const { player, tick } = snapshot;
            if (command.type === 'equip-weapon') {
                this.equipped.set(player.playerId, command.weapon);
                continue;
            }
            const weapon = this.equipped.get(player.playerId);
            const isReady = tick >= (this.nextAttackTick.get(player.playerId) ?? 0);
            if (weapon === undefined || !isReady) continue;

            // A miss also consumes a swing; tabs share this cooldown.
            const definition = meleeWeapons[weapon];
            this.nextAttackTick.set(player.playerId, tick + definition.cooldownTicks);
            const target = findMeleeTarget({
                position: player.position,
                zombies,
                obstacles,
                weapon,
            });
            const applied =
                target === undefined ? null : damage(target.zombieId, definition.damage);
            let impact: MeleeImpact = { outcome: 'miss', position: { ...player.position } };

            if (target !== undefined && applied !== null) {
                impact = {
                    outcome: applied.isKilled ? 'kill' : 'hit',
                    zombieId: target.zombieId,
                    position: { ...target.position },
                    damage: applied.damage,
                };
            }

            this.actions.set(player.playerId, {
                type: 'melee-action',
                protocolVersion,
                meleeVersion,
                worldId: snapshot.worldId,
                playerId: player.playerId,
                tick,
                weapon,
                impact,
            });
        }
        this.pending.clear();
    }
    action(movement: MovementSnapshot): MeleeAction | null {
        return this.actions.get(movement.player.playerId) ?? null;
    }
    snapshot(movement: MovementSnapshot): MeleeSnapshot {
        return {
            type: 'melee-state',
            protocolVersion,
            meleeVersion,
            worldId: movement.worldId,
            playerId: movement.player.playerId,
            tick: movement.tick,
            weapon: this.equipped.get(movement.player.playerId) ?? null,
        };
    }
}
