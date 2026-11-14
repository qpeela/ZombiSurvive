import { pistolSettings } from '@zombi-survive/content';
import type { Item, WorldObstacle, ZombieState } from '@zombi-survive/domain';
import {
    firearmVersion,
    isShootCommand,
    type MeleeImpact,
    type MovementSnapshot,
    protocolVersion,
    type ShootCommand,
    type ShotAction,
} from '@zombi-survive/protocol';
import { spendPistolRound, tracePistolShot } from '@zombi-survive/simulation';

export class LocalWorldFirearm {
    private readonly pending = new Map<string, ShootCommand>();
    private readonly actions = new Map<string, ShotAction>();

    receive(sessionId: string, value: unknown): void {
        if (isShootCommand(value)) this.pending.set(sessionId, { ...value, aim: { ...value.aim } });
    }
    leave(sessionId: string): void {
        this.pending.delete(sessionId);
    }
    clearPlayer(playerId: string): void {
        this.actions.delete(playerId);
    }
    step(input: {
        snapshots: ReadonlyMap<string, MovementSnapshot>;
        zombies: readonly ZombieState[];
        obstacles: readonly WorldObstacle[];
        health: (snapshot: MovementSnapshot) => number;
        hands: (playerId: string) => Item | null;
        stageItem: (item: Item) => void;
        reserveAttack: (input: {
            playerId: string;
            tick: number;
            cooldownTicks: number;
        }) => boolean;
        damage: (id: string, amount: number) => { damage: number; isKilled: boolean } | null;
    }): void {
        this.actions.clear();
        for (const [sessionId, command] of this.pending) {
            const snapshot = input.snapshots.get(sessionId);
            if (snapshot === undefined || input.health(snapshot) <= 0) continue;
            const { player, tick } = snapshot;
            const hands = input.hands(player.playerId);
            const isPistol = hands?.kind === 'pistol' && hands.itemId === command.itemId;
            if (!isPistol) continue;
            const next = spendPistolRound(hands, command.weaponRevision);
            if (next === null) continue;
            const traced = tracePistolShot({
                origin: player.position,
                aim: command.aim,
                zombies: input.zombies,
                obstacles: input.obstacles,
            });
            if (traced === null) continue;
            if (
                !input.reserveAttack({
                    playerId: player.playerId,
                    tick,
                    cooldownTicks: pistolSettings.cooldownTicks,
                })
            )
                continue;
            input.stageItem(next);
            const applied =
                traced.zombie === null
                    ? null
                    : input.damage(traced.zombie.zombieId, pistolSettings.damage);
            let impact: MeleeImpact = { outcome: 'miss', position: traced.position };
            if (traced.zombie !== null && applied !== null)
                impact = {
                    outcome: applied.isKilled ? 'kill' : 'hit',
                    position: traced.position,
                    zombieId: traced.zombie.zombieId,
                    damage: applied.damage,
                };
            this.actions.set(player.playerId, {
                type: 'shot-action',
                protocolVersion,
                firearmVersion,
                worldId: snapshot.worldId,
                playerId: player.playerId,
                tick,
                itemId: hands.itemId,
                weaponRevision: next.revision ?? 0,
                origin: { ...player.position },
                impact,
            });
        }
        this.pending.clear();
    }
    action(movement: MovementSnapshot): ShotAction | null {
        return this.actions.get(movement.player.playerId) ?? null;
    }
}
