import { pistolSettings } from '@zombi-survive/content';
import type { ItemLocation } from '@zombi-survive/domain';
import {
    type FirearmSnapshot,
    firearmVersion,
    isReloadCommand,
    type MovementSnapshot,
    protocolVersion,
    type ReloadCommand,
} from '@zombi-survive/protocol';
import { reloadPistol } from '@zombi-survive/simulation';

type Reload = {
    readonly itemId: string;
    readonly revision: number;
    readonly startedAtTick: number;
};
type StepInput = {
    snapshots: ReadonlyMap<string, MovementSnapshot>;
    health: (snapshot: MovementSnapshot) => number;
    locations: () => readonly ItemLocation[];
};

/** Progress is transient: disconnect/restart cancels without transferring rounds. */
export class LocalWorldReload {
    private readonly pending = new Map<string, ReloadCommand>();
    private readonly active = new Map<string, Reload>();
    receive(sessionId: string, value: unknown): void {
        if (isReloadCommand(value)) this.pending.set(sessionId, { ...value });
    }
    leave(sessionId: string): void {
        this.pending.delete(sessionId);
    }
    clearPlayer(playerId: string): void {
        this.active.delete(playerId);
    }
    isReloading(playerId: string): boolean {
        return this.active.has(playerId);
    }
    prepare(input: StepInput): void {
        const players = new Map(
            [...input.snapshots.values()].map(snapshot => [snapshot.player.playerId, snapshot]),
        );
        const locations = input.locations();
        for (const [playerId, reload] of this.active) {
            const snapshot = players.get(playerId);
            if (snapshot === undefined || input.health(snapshot) <= 0) {
                this.active.delete(playerId);
                continue;
            }
            const result = reloadPistol({
                locations,
                playerId,
                itemId: reload.itemId,
                revision: reload.revision,
            });
            if (result === locations) this.active.delete(playerId);
        }
        for (const [sessionId, command] of this.pending) {
            const snapshot = input.snapshots.get(sessionId);
            if (snapshot === undefined || input.health(snapshot) <= 0) continue;
            const playerId = snapshot.player.playerId;
            if (this.active.has(playerId)) continue;
            const result = reloadPistol({
                locations,
                playerId,
                itemId: command.itemId,
                revision: command.weaponRevision,
            });
            if (result !== locations)
                this.active.set(playerId, {
                    itemId: command.itemId,
                    revision: command.weaponRevision,
                    startedAtTick: snapshot.tick,
                });
        }
        this.pending.clear();
    }
    finish(input: StepInput & { stage: (locations: readonly ItemLocation[]) => void }): void {
        const players = new Map(
            [...input.snapshots.values()].map(snapshot => [snapshot.player.playerId, snapshot]),
        );
        for (const [playerId, reload] of this.active) {
            const snapshot = players.get(playerId);
            if (snapshot === undefined || input.health(snapshot) <= 0) {
                this.active.delete(playerId);
                continue;
            }
            if (snapshot.tick - reload.startedAtTick < pistolSettings.reloadTicks) continue;
            const locations = input.locations();
            const result = reloadPistol({
                locations,
                playerId,
                itemId: reload.itemId,
                revision: reload.revision,
            });
            if (result !== locations) input.stage(result);
            this.active.delete(playerId);
        }
    }
    snapshot(movement: MovementSnapshot): FirearmSnapshot {
        const reload = this.active.get(movement.player.playerId);
        return {
            type: 'firearm-state',
            protocolVersion,
            firearmVersion,
            worldId: movement.worldId,
            playerId: movement.player.playerId,
            tick: movement.tick,
            reload:
                reload === undefined
                    ? null
                    : {
                          itemId: reload.itemId,
                          totalTicks: pistolSettings.reloadTicks,
                          remainingTicks: Math.max(
                              0,
                              pistolSettings.reloadTicks - (movement.tick - reload.startedAtTick),
                          ),
                      },
        };
    }
}
