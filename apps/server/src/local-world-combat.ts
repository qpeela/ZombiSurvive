import { combatSettings } from '@zombi-survive/content';
import type {
    BleedingState,
    ItemLocation,
    PlayerHealth,
    WorldObstacle,
    ZombieAttackState,
    ZombieState,
} from '@zombi-survive/domain';
import { playerLifeState } from '@zombi-survive/domain';
import {
    type HealthSnapshot,
    healthVersion,
    type MovementSnapshot,
    protocolVersion,
} from '@zombi-survive/protocol';
import {
    stepBleeding,
    stepZombieAttack,
    useBandage,
    woundFromZombieHit,
} from '@zombi-survive/simulation';

export class LocalWorldCombat {
    private readonly players = new Map<string, PlayerHealth & BleedingState>();
    private readonly attacks = new Map<string, ZombieAttackState>();
    private readonly combatTicks = new Map<string, number>();
    private readonly roll: () => number;

    constructor(initialHealth?: PlayerHealth & BleedingState, roll: () => number = Math.random) {
        this.roll = roll;

        if (initialHealth !== undefined)
            this.players.set(initialHealth.playerId, { ...initialHealth });
    }

    respawnPlayer(playerId: string): void {
        this.combatTicks.delete(playerId);
        this.players.set(playerId, {
            playerId,
            health: combatSettings.maxHealth,
            bleedingTicks: 0,
        });
        for (const [id, attack] of this.attacks) {
            if (attack.targetPlayerId === playerId) this.attacks.delete(id);
        }
    }

    health(playerId: string): number {
        return this.players.get(playerId)?.health ?? combatSettings.maxHealth;
    }

    bleedingTicks(playerId: string): number {
        return this.players.get(playerId)?.bleedingTicks ?? 0;
    }

    remainingCombatTicks(playerId: string): number {
        return this.combatTicks.get(playerId) ?? 0;
    }

    markAttack(playerId: string): void {
        const player = this.players.get(playerId);
        if (player !== undefined && player.health > 0)
            this.combatTicks.set(playerId, combatSettings.combatDurationTicks);
    }

    useBandage({
        snapshot,
        locations,
        itemId,
    }: {
        readonly snapshot: MovementSnapshot;
        readonly locations: readonly ItemLocation[];
        readonly itemId: string;
    }): readonly ItemLocation[] {
        const player = this.players.get(snapshot.player.playerId);

        if (player === undefined) return locations;

        const result = useBandage({ locations, player, itemId });
        this.players.set(player.playerId, result.player);

        return result.locations;
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
        for (const [playerId, ticks] of this.combatTicks) {
            if (ticks <= 1) this.combatTicks.delete(playerId);
            else this.combatTicks.set(playerId, ticks - 1);
        }

        for (const { player } of snapshots.values()) {
            if (!this.players.has(player.playerId)) {
                this.players.set(player.playerId, {
                    playerId: player.playerId,
                    health: combatSettings.maxHealth,
                    bleedingTicks: 0,
                });
            }
        }

        for (const [playerId, state] of this.players) {
            const next = stepBleeding(state);
            this.players.set(playerId, next);
            if (next.health < state.health) this.markAttack(playerId);
        }

        const ids = new Set(zombies.map(zombie => zombie.zombieId));
        for (const id of this.attacks.keys()) {
            if (!ids.has(id)) this.attacks.delete(id);
        }
        for (const zombie of zombies) {
            const target = [...snapshots.values()].find(
                snapshot => snapshot.player.playerId === zombie.targetPlayerId,
            )?.player;
            const previous = target === undefined ? undefined : this.players.get(target.playerId);
            const result = stepZombieAttack({
                zombie,
                attack: this.attacks.get(zombie.zombieId) ?? {
                    targetPlayerId: null,
                    ticksUntilHit: 0,
                },
                target,
                health: previous,
                obstacles,
            });
            this.attacks.set(zombie.zombieId, result.attack);
            if (result.health !== undefined && previous !== undefined) {
                const next = { ...previous, health: result.health.health };
                const isHit = next.health < previous.health;
                this.players.set(
                    next.playerId,
                    isHit ? woundFromZombieHit(next, this.roll()) : next,
                );
                if (isHit) this.markAttack(next.playerId);
            }
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
            lifeState: playerLifeState(this.health(movement.player.playerId)),
            maxHealth: combatSettings.maxHealth,
            bleedingTicks: this.bleedingTicks(movement.player.playerId),
            combatTicks: this.remainingCombatTicks(movement.player.playerId),
        };
    }
}
