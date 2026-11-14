import { randomUUID } from 'node:crypto';

import { type AuthContext, type Client, Room } from '@colyseus/core';
import { combatSettings, corpseSettings, movementSettings } from '@zombi-survive/content';
import type { Corpse } from '@zombi-survive/domain';
import {
    initialStateRequest,
    isCurrentLifeCommand,
    isRespawnCommand,
    localWorldRoomId,
    type MovementSnapshot,
    pickupStateRequest,
} from '@zombi-survive/protocol';
import { findRespawnPosition } from '@zombi-survive/simulation';
import { loadWorldChunks } from '@zombi-survive/worldgen';

import { LocalWorldCombat } from './local-world-combat.ts';
import { LocalWorldFirearm } from './local-world-firearm.ts';
import { LocalWorldMelee } from './local-world-melee.ts';
import { LocalWorldMovement } from './local-world-movement.ts';
import { LocalWorldPickup } from './local-world-pickup.ts';
import { createLocalWorldProfile } from './local-world-profile.ts';
import { LocalWorldReload } from './local-world-reload.ts';
import { LocalWorldZombie } from './local-world-zombie.ts';
import type { SavedCombat } from './saved-combat.ts';
import type { SoloWorldStore } from './solo-world-store.ts';
import type { WorldAccess } from './world-access.ts';

export class LocalWorldRoom extends Room {
    private readonly reload = new LocalWorldReload();
    private readonly firearm = new LocalWorldFirearm();
    private pickup = new LocalWorldPickup();
    private readonly zombie = new LocalWorldZombie();
    private combat = new LocalWorldCombat();
    private melee = new LocalWorldMelee(snapshot => this.pickup.weapon(snapshot));
    private movement: LocalWorldMovement | null = null;
    private access: WorldAccess | null = null;
    private saveTimer: ReturnType<typeof setInterval> | undefined;
    private isStopping = false;
    private pendingStep: (() => void) | null = null;
    private save: (() => void) | undefined;

    override onCreate(options: {
        access: WorldAccess;
        soloStore?: SoloWorldStore;
        onSaveError: (error: unknown) => void;
        now?: () => number;
    }): void {
        this.roomId = localWorldRoomId;
        this.autoDispose = false;
        this.maxMessagesPerSecond = 20;
        this.maxClients = 16;
        this.access = options.access;

        const now = options.now ?? Date.now;
        const saved = options.soloStore?.initialWorld;
        const soloPlayerId = options.access.soloPlayerId;
        let savedCombat: SavedCombat = options.soloStore?.initialCombat ?? {
            health: combatSettings.maxHealth,
            cooldownTicks: 0,
            bleedingTicks: 0,
        };
        let lifeRevision = savedCombat.lifeRevision ?? 0;
        let pendingRespawn: number | null = null;
        this.combat = new LocalWorldCombat({
            playerId: soloPlayerId,
            health: savedCombat.health,
            bleedingTicks: savedCombat.bleedingTicks,
        });
        this.melee = new LocalWorldMelee(snapshot => this.pickup.weapon(snapshot), {
            playerId: soloPlayerId,
            cooldownTicks: savedCombat.cooldownTicks,
        });
        let corpses: readonly Corpse[] = options.soloStore?.initialCorpses ?? [];
        this.pickup = new LocalWorldPickup(options.soloStore?.initialItemLocations, corpses, now);
        const movement = new LocalWorldMovement(
            saved?.worldId ?? randomUUID(),
            options.access.soloPlayerId,
            saved?.position,
        );
        this.movement = movement;
        const profile = createLocalWorldProfile(options.soloStore);
        this.onMessage<unknown>('rename-player', (client, command) =>
            profile.rename(movement.snapshot(client.sessionId), command),
        );

        if (options.soloStore !== undefined) {
            const store = options.soloStore;
            this.save = () => {
                try {
                    store.savePosition(movement.soloPosition());
                } catch (error) {
                    this.isStopping = true;
                    clearInterval(this.saveTimer);
                    options.onSaveError(error);
                }
            };
            this.saveTimer = setInterval(this.save, 1000);
        }

        this.onMessage(initialStateRequest, client => movement.snapshot(client.sessionId));
        this.onMessage(pickupStateRequest, client =>
            this.pickup.snapshot(movement.snapshot(client.sessionId)),
        );
        for (const type of ['equip-weapon', 'unequip-weapon']) {
            this.onMessage<unknown>(type, (client, value) => {
                if (isCurrentLifeCommand(value, lifeRevision))
                    this.pickup.receiveEquipment(client.sessionId, value);
            });
        }
        this.onMessage<unknown>('reload-pistol', (client, value) => {
            if (isCurrentLifeCommand(value, lifeRevision))
                this.reload.receive(client.sessionId, value);
        });
        this.onMessage<unknown>('shoot-pistol', (client, value) => {
            if (isCurrentLifeCommand(value, lifeRevision))
                this.firearm.receive(client.sessionId, value);
        });
        this.onMessage<unknown>('melee-attack', (client, value) => {
            if (isCurrentLifeCommand(value, lifeRevision))
                this.melee.receive(client.sessionId, value);
        });
        this.onMessage<unknown>('pickup-item', (client, value) => {
            if (isCurrentLifeCommand(value, lifeRevision))
                this.pickup.receive(client.sessionId, value);
        });
        this.onMessage<unknown>('inventory-move', (client, value) => {
            if (isCurrentLifeCommand(value, lifeRevision))
                this.pickup.receiveMove(client.sessionId, value);
        });
        this.onMessage<unknown>('use-bandage', (client, value) => {
            if (isCurrentLifeCommand(value, lifeRevision))
                this.pickup.receiveUseBandage(client.sessionId, value);
        });
        this.onMessage<unknown>('movement-input', (client, value) => {
            if (isCurrentLifeCommand(value, lifeRevision))
                movement.receive(client.sessionId, value);
        });
        this.onMessage<unknown>('movement-target', (client, value) => {
            if (isCurrentLifeCommand(value, lifeRevision))
                movement.receive(client.sessionId, value);
        });
        this.onMessage<unknown>('respawn-player', (client, value) => {
            if (options.soloStore === undefined || client.auth !== soloPlayerId) return;
            if (isRespawnCommand(value) && value.lifeRevision === lifeRevision)
                pendingRespawn = value.lifeRevision;
        });
        this.setTimestep(() => {
            if (this.isStopping || this.pendingStep !== null) {
                return;
            }

            const nowMs = now();
            const expectedLife = pendingRespawn;
            pendingRespawn = null;
            const storeForRespawn = options.soloStore;
            if (
                expectedLife !== null &&
                expectedLife === lifeRevision &&
                this.combat.health(soloPlayerId) === 0 &&
                storeForRespawn !== undefined
            ) {
                const position = findRespawnPosition({
                    obstacles: loadWorldChunks({
                        positions: [{ xMeters: 0, yMeters: 0 }],
                        previousChunks: [],
                    }).flatMap(chunk => chunk.obstacles),
                    occupied: this.clients.flatMap(client =>
                        movement
                            .snapshot(client.sessionId)
                            .otherPlayers.map(player => player.position),
                    ),
                    zombies: this.zombie.spawnBlockers(),
                });
                if (position !== null) {
                    const finishRespawn = (): void => {
                        this.pendingStep = null;
                        try {
                            savedCombat = storeForRespawn.saveRespawn(expectedLife, position);
                            lifeRevision = savedCombat.lifeRevision ?? 0;
                            movement.respawnPlayer(soloPlayerId, position);
                            this.combat.respawnPlayer(soloPlayerId);
                            this.melee.respawnPlayer(soloPlayerId);
                            this.firearm.clearPlayer(soloPlayerId);
                            this.reload.clearPlayer(soloPlayerId);
                            for (const client of this.clients) {
                                this.pickup.leave(client.sessionId);
                                this.melee.leave(client.sessionId);
                                this.firearm.leave(client.sessionId);
                                this.reload.leave(client.sessionId);
                            }
                        } catch (error) {
                            this.isStopping = true;
                            clearInterval(this.saveTimer);
                            options.onSaveError(error);
                        }
                    };
                    this.deferStep(finishRespawn);
                    return;
                }
            }

            const expiredCorpses = this.pickup.stageExpiry(nowMs);
            movement.step(playerId => this.combat.health(playerId));

            const snapshots = new Map(
                this.clients.map(client => [client.sessionId, movement.snapshot(client.sessionId)]),
            );
            this.pickup.step(
                snapshots,
                snapshot => this.combat.snapshot(snapshot).health,
                input => this.combat.useBandage(input),
            );
            const zombie = this.zombie.step(
                snapshots,
                playerId => this.combat.health(playerId) > 0,
            );
            this.melee.step({
                ...zombie,
                snapshots,
                health: snapshot => this.combat.snapshot(snapshot).health,
                damage: (id, amount) => this.zombie.damage(id, amount),
            });
            const reloadInput = {
                snapshots,
                health: (snapshot: MovementSnapshot) => this.combat.snapshot(snapshot).health,
                locations: () => this.pickup.stagedLocations(),
            };
            this.reload.prepare(reloadInput);
            this.firearm.step({
                isReloading: playerId => this.reload.isReloading(playerId),
                snapshots,
                zombies: this.zombie.shotTargets(),
                obstacles: zombie.obstacles,
                health: snapshot => this.combat.snapshot(snapshot).health,
                hands: playerId => this.pickup.hands(playerId),
                stageItem: item => {
                    this.pickup.stageItem(item);
                },
                reserveAttack: input => this.melee.reserveAttack(input),
                damage: (id, amount) => this.zombie.damage(id, amount),
            });
            const living = zombie.zombies.filter(state => this.zombie.isAlive(state.zombieId));
            this.combat.step({ ...zombie, zombies: living, snapshots });
            this.reload.finish({
                ...reloadInput,
                stage: locations => {
                    this.pickup.stageLocations(locations);
                },
            });

            for (const [sessionId, snapshot] of snapshots) {
                if (this.combat.health(snapshot.player.playerId) > 0) continue;

                movement.stopPlayer(snapshot.player.playerId);
                snapshots.set(sessionId, movement.snapshot(sessionId));
            }

            const nextCombat: SavedCombat = {
                ...(lifeRevision === 0 ? {} : { lifeRevision }),
                health: this.combat.health(soloPlayerId),
                cooldownTicks: this.melee.remainingCooldown(soloPlayerId),
                bleedingTicks: this.combat.bleedingTicks(soloPlayerId),
            };
            const isCombatChanged =
                nextCombat.health !== savedCombat.health ||
                nextCombat.cooldownTicks !== savedCombat.cooldownTicks ||
                nextCombat.bleedingTicks !== savedCombat.bleedingTicks;
            // A committed equipment change becomes active in combat on the next step.
            const meleeStates = new Map(
                [...snapshots].map(([sessionId, snapshot]) => [
                    sessionId,
                    this.melee.snapshot(snapshot),
                ]),
            );
            const store = options.soloStore;
            const isDying = savedCombat.health > 0 && nextCombat.health === 0;
            const deathPosition = isDying ? movement.soloPosition() : undefined;
            let nextCorpses = expiredCorpses ?? corpses;
            if (deathPosition !== undefined) {
                const corpse: Corpse = {
                    corpseId: randomUUID(),
                    playerId: soloPlayerId,
                    position: deathPosition,
                    diedAtMs: nowMs,
                    expiresAtMs: nowMs + corpseSettings.lifetimeMs,
                };
                this.pickup.stageDeath(corpse);
                nextCorpses = [...nextCorpses, corpse];
            }
            const itemSave = this.pickup.takePendingSave();
            if (store === undefined) {
                corpses = nextCorpses;
                savedCombat = nextCombat;
                this.pickup.setCorpses(corpses);
            }
            const publish = (): void => {
                for (const shot of this.firearm.acceptedShots()) this.zombie.hearShot(shot);
                for (const client of this.clients) {
                    const snapshot = snapshots.get(client.sessionId);
                    const meleeState = meleeStates.get(client.sessionId);

                    if (snapshot !== undefined && meleeState !== undefined) {
                        client.send('movement-snapshot', snapshot);
                        client.send('pickup-state', this.pickup.snapshot(snapshot));
                        client.send('zombie-state', this.zombie.snapshot(snapshot));
                        client.send('health-state', {
                            ...this.combat.snapshot(snapshot),
                            lifeRevision,
                        });
                        client.send('melee-state', meleeState);
                        client.send('firearm-state', this.reload.snapshot(snapshot));
                        const action = this.melee.action(snapshot);

                        if (action !== null) {
                            client.send('melee-action', action);
                        }

                        const shot = this.firearm.action(snapshot);
                        if (shot !== null) client.send('shot-action', shot);

                        const playerProfile = profile.snapshot(snapshot);

                        if (playerProfile !== null) {
                            client.send('profile-state', playerProfile);
                        }
                    }
                }
            };

            if (store === undefined || (!isCombatChanged && itemSave === null)) {
                publish();

                return;
            }

            // Freeze further steps until this step is durable. No IO runs in timestep.
            const finishStep = (): void => {
                this.pendingStep = null;
                try {
                    if (isDying || expiredCorpses !== null)
                        store.saveCombat(
                            nextCombat,
                            itemSave ?? undefined,
                            deathPosition,
                            nextCorpses,
                        );
                    else if (isCombatChanged) store.saveCombat(nextCombat, itemSave ?? undefined);
                    else if (itemSave !== null) store.saveItemLocations(itemSave);

                    if (itemSave !== null) {
                        this.pickup.confirmSave();
                    }

                    corpses = nextCorpses;
                    this.pickup.setCorpses(corpses);
                    savedCombat = nextCombat;
                } catch (error) {
                    this.isStopping = true;
                    clearInterval(this.saveTimer);
                    options.onSaveError(error);

                    return;
                }

                publish();
            };
            this.deferStep(finishStep);
        }, 1000 / movementSettings.ticksPerSecond);
    }

    private deferStep(finish: () => void): void {
        this.pendingStep = finish;
        setImmediate(() => {
            if (!this.isStopping && this.pendingStep === finish) finish();
        });
    }

    override onAuth(_client: Client, _options: unknown, context: AuthContext): string | false {
        return this.access?.authenticate(context.headers) ?? false;
    }

    override onJoin(client: Client): void {
        const playerId: unknown = client.auth;

        if (typeof playerId !== 'string') {
            throw new Error('Player authentication is missing.');
        }

        this.movement?.join(client.sessionId, playerId);
        this.pickup.initializePlayer(playerId);
    }

    override onLeave(client: Client): void {
        this.movement?.leave(client.sessionId);
        this.pickup.leave(client.sessionId);
        this.melee.leave(client.sessionId);
        this.firearm.leave(client.sessionId);
        this.reload.leave(client.sessionId);
    }

    override onBeforeShutdown(): void {
        if (!this.isStopping) {
            this.pendingStep?.();
        }

        if (!this.isStopping) {
            this.isStopping = true;
            this.save?.();
        }

        clearInterval(this.saveTimer);
        super.onBeforeShutdown();
    }

    override onDispose(): void {
        this.isStopping = true;
        clearInterval(this.saveTimer);
    }
}
