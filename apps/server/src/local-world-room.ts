import { randomUUID } from 'node:crypto';

import { type AuthContext, type Client, Room } from '@colyseus/core';
import {
    combatSettings,
    corpseSettings,
    movementSettings,
    worldGenerationSettings,
} from '@zombi-survive/content';
import type { Corpse } from '@zombi-survive/domain';
import {
    initialStateRequest,
    isCurrentLifeCommand,
    isRespawnCommand,
    localWorldRoomId,
    type MovementSnapshot,
    type PickupSnapshot,
    pickupStateRequest,
} from '@zombi-survive/protocol';
import {
    advanceNeeds,
    drinkWater,
    findRespawnPosition,
    initialPlayerNeeds,
    movementStepSeconds,
    stepWorldClock,
} from '@zombi-survive/simulation';
import { generateChunkLoot, loadWorldChunks } from '@zombi-survive/worldgen';

import { LocalWorldCombat } from './local-world-combat.ts';
import { LocalWorldFirearm } from './local-world-firearm.ts';
import { LocalWorldLootTimers } from './local-world-loot-timers.ts';
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
    private readonly visitedLootChunks = new Set<string>();
    private readonly firearm = new LocalWorldFirearm();
    private pickup = new LocalWorldPickup();
    private lootTimers = new LocalWorldLootTimers();
    private zombie = new LocalWorldZombie();
    private combat = new LocalWorldCombat();
    private melee = new LocalWorldMelee(snapshot => this.pickup.weapon(snapshot));
    private movement: LocalWorldMovement | null = null;
    private access: WorldAccess | null = null;
    private saveTimer: ReturnType<typeof setInterval> | undefined;
    private isStopping = false;
    private worldTimeMs = 0;
    private offlineVulnerabilityTicks = 0;
    private pendingStep: (() => void) | null = null;
    private save: ((logoutVulnerabilityTicks?: number) => boolean) | undefined;

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
        this.worldTimeMs = options.soloStore?.initialWorldTimeMs ?? 0;
        this.lootTimers = new LocalWorldLootTimers(
            options.soloStore?.lootPoints(),
            options.soloStore?.initialLootRestocks,
        );
        const saved = options.soloStore?.initialWorld;
        this.zombie = new LocalWorldZombie(
            options.soloStore?.initialZombieHealth,
            options.soloStore?.initialZombiePositions,
        );
        const soloPlayerId = options.access.soloPlayerId;
        let savedCombat: SavedCombat = options.soloStore?.initialCombat ?? {
            health: combatSettings.maxHealth,
            cooldownTicks: 0,
            bleedingTicks: 0,
        };
        let needs = options.soloStore?.initialNeeds ?? initialPlayerNeeds;
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
        this.offlineVulnerabilityTicks = savedCombat.logoutVulnerabilityTicks ?? 0;
        if (this.offlineVulnerabilityTicks > 0) {
            movement.join('restored:offline', soloPlayerId);
            movement.leave('restored:offline');
        }
        const profile = createLocalWorldProfile(options.soloStore);
        this.onMessage<unknown>('rename-player', (client, command) =>
            profile.rename(movement.snapshot(client.sessionId), command),
        );

        if (options.soloStore !== undefined) {
            const store = options.soloStore;
            this.save = logoutVulnerabilityTicks => {
                try {
                    if (logoutVulnerabilityTicks === undefined) {
                        store.savePosition(movement.soloPosition(), this.worldTimeMs, needs);
                    } else {
                        const nextCombat: SavedCombat = {
                            health: savedCombat.health,
                            cooldownTicks: savedCombat.cooldownTicks,
                            bleedingTicks: savedCombat.bleedingTicks,
                            ...(savedCombat.lifeRevision === undefined
                                ? {}
                                : { lifeRevision: savedCombat.lifeRevision }),
                            ...(logoutVulnerabilityTicks > 0 ? { logoutVulnerabilityTicks } : {}),
                        };
                        store.saveCombat(
                            nextCombat,
                            undefined,
                            movement.soloPosition(),
                            undefined,
                            undefined,
                            undefined,
                            { worldTimeMs: this.worldTimeMs, needs },
                        );
                        savedCombat = nextCombat;
                    }
                    return true;
                } catch (error) {
                    this.isStopping = true;
                    clearInterval(this.saveTimer);
                    options.onSaveError(error);
                    return false;
                }
            };
            this.saveTimer = setInterval(this.save, 1000);
        }

        const worldSnapshot = (sessionId: string): MovementSnapshot => ({
            ...movement.snapshot(sessionId),
            worldTimeMs: this.worldTimeMs,
        });
        this.onMessage(initialStateRequest, client => worldSnapshot(client.sessionId));
        const pickupSnapshot = (snapshot: MovementSnapshot): PickupSnapshot => ({
            ...this.pickup.snapshot(snapshot),
            restocks: this.lootTimers.snapshot(snapshot.player.position),
        });
        this.onMessage(pickupStateRequest, client =>
            pickupSnapshot(movement.snapshot(client.sessionId)),
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
        this.onMessage<unknown>('drink-water', (client, value) => {
            if (options.soloStore !== undefined && isCurrentLifeCommand(value, lifeRevision))
                this.pickup.receiveDrink(client.sessionId, value);
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

            const previousWorldTimeMs = this.worldTimeMs;
            this.worldTimeMs = stepWorldClock(this.worldTimeMs, movementStepSeconds);
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
                            savedCombat = storeForRespawn.saveRespawn(
                                expectedLife,
                                position,
                                this.worldTimeMs,
                            );
                            needs = initialPlayerNeeds;
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
            movement.step(
                playerId => this.combat.health(playerId),
                playerId => this.pickup.weightGrams(playerId),
            );

            const snapshots = new Map(
                this.clients.map(client => [client.sessionId, worldSnapshot(client.sessionId)]),
            );
            if (this.offlineVulnerabilityTicks > 0) {
                const offline = movement.disconnectedSoloSnapshot();
                if (offline !== null) snapshots.set('offline:solo', offline);
            }
            const isSoloPresent =
                movement.isPlayerConnected(soloPlayerId) || snapshots.has('offline:solo');
            if (
                options.soloStore !== undefined &&
                isSoloPresent &&
                this.combat.health(soloPlayerId) > 0
            )
                needs = advanceNeeds(needs, this.worldTimeMs - previousWorldTimeMs);

            this.pickup.step(
                snapshots,
                snapshot => this.combat.snapshot(snapshot).health,
                input => this.combat.useBandage(input),
                ({ snapshot, locations, itemId }) => {
                    if (snapshot.player.playerId !== soloPlayerId) return locations;
                    const result = drinkWater({ needs, locations, itemId, playerId: soloPlayerId });
                    needs = result.needs;
                    return result.locations;
                },
            );
            if (options.soloStore !== undefined) {
                for (const { player } of snapshots.values()) {
                    if (this.combat.health(player.playerId) <= 0) continue;
                    const size = worldGenerationSettings.chunkSizeMeters;
                    const chunkX = Math.floor((player.position.xMeters + size / 2) / size);
                    const chunkY = Math.floor((player.position.yMeters + size / 2) / size);
                    const id = `${String(chunkX)},${String(chunkY)}`;
                    if (this.visitedLootChunks.has(id)) continue;
                    const locations = this.pickup.stagedLocations();
                    const known = new Set(locations.map(location => location.item.itemId));
                    const loot = generateChunkLoot({
                        seed: worldGenerationSettings.initialSeed,
                        generatorVersion: worldGenerationSettings.generatorVersion,
                        chunkX,
                        chunkY,
                    }).filter(item => !known.has(item.itemId));
                    this.lootTimers.register(loot);
                    if (loot.length > 0)
                        this.pickup.stageLocations([
                            ...locations,
                            ...loot.map(item => ({ type: 'ground' as const, item })),
                        ]);
                    this.visitedLootChunks.add(id);
                }
            }
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
            for (const snapshot of snapshots.values()) {
                const acceptedAttack =
                    this.melee.action(snapshot) !== null || this.firearm.action(snapshot) !== null;
                if (acceptedAttack) this.combat.markAttack(snapshot.player.playerId);
            }
            this.reload.finish({
                ...reloadInput,
                stage: locations => {
                    this.pickup.stageLocations(locations);
                },
            });

            for (const [sessionId, snapshot] of snapshots) {
                if (this.combat.health(snapshot.player.playerId) > 0) continue;

                movement.stopPlayer(snapshot.player.playerId);
                if (sessionId !== 'offline:solo')
                    snapshots.set(sessionId, movement.snapshot(sessionId));
            }

            const wasOfflineVulnerable =
                this.offlineVulnerabilityTicks > 0 && !movement.isPlayerConnected(soloPlayerId);
            const nextLogoutVulnerabilityTicks =
                wasOfflineVulnerable && this.combat.health(soloPlayerId) > 0
                    ? this.offlineVulnerabilityTicks - 1
                    : 0;
            const nextCombat: SavedCombat = {
                ...(lifeRevision === 0 ? {} : { lifeRevision }),
                health: this.combat.health(soloPlayerId),
                cooldownTicks: this.melee.remainingCooldown(soloPlayerId),
                bleedingTicks: this.combat.bleedingTicks(soloPlayerId),
                ...(nextLogoutVulnerabilityTicks > 0
                    ? { logoutVulnerabilityTicks: nextLogoutVulnerabilityTicks }
                    : {}),
            };
            const isCombatChanged =
                nextCombat.health !== savedCombat.health ||
                nextCombat.cooldownTicks !== savedCombat.cooldownTicks ||
                nextCombat.bleedingTicks !== savedCombat.bleedingTicks ||
                nextCombat.logoutVulnerabilityTicks !== savedCombat.logoutVulnerabilityTicks;
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
            const replenished = this.lootTimers.replenish(
                this.pickup.stagedLocations(),
                this.worldTimeMs,
            );
            if (replenished !== null) this.pickup.stageLocations(replenished);

            this.lootTimers.stage(this.pickup.stagedLocations(), this.worldTimeMs);
            const timerSave = this.lootTimers.pendingSave();
            const worldProgress = {
                needs,
                worldTimeMs: this.worldTimeMs,
                ...(timerSave === null ? {} : { restocks: timerSave }),
            };
            const itemSave = this.pickup.takePendingSave();
            const zombieSave = this.zombie.pendingHealthSave();
            const positionSave = this.zombie.pendingPositionSave();
            if (store === undefined) {
                corpses = nextCorpses;
                savedCombat = nextCombat;
                this.offlineVulnerabilityTicks = nextCombat.logoutVulnerabilityTicks ?? 0;
                this.pickup.setCorpses(corpses);
                this.zombie.confirmHealthSave();
                this.zombie.confirmPositionSave();
                this.lootTimers.confirmSave();
            }
            const publish = (): void => {
                for (const shot of this.firearm.acceptedShots()) this.zombie.hearShot(shot);
                for (const client of this.clients) {
                    const snapshot = snapshots.get(client.sessionId);
                    const meleeState = meleeStates.get(client.sessionId);

                    if (snapshot !== undefined && meleeState !== undefined) {
                        client.send('movement-snapshot', snapshot);
                        client.send('pickup-state', pickupSnapshot(snapshot));
                        client.send('zombie-state', this.zombie.snapshot(snapshot));
                        client.send('health-state', {
                            ...this.combat.snapshot(snapshot),
                            lifeRevision,
                            ...(store === undefined ? {} : { needs }),
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
                if (wasOfflineVulnerable && this.offlineVulnerabilityTicks === 0)
                    movement.hideDisconnectedSoloPlayer();
            };

            if (
                store === undefined ||
                (!isCombatChanged &&
                    itemSave === null &&
                    zombieSave === null &&
                    positionSave === null &&
                    timerSave === null)
            ) {
                publish();

                return;
            }

            // Freeze further steps until this step is durable. No IO runs in timestep.
            const finishStep = (): void => {
                this.pendingStep = null;
                try {
                    if (
                        isDying ||
                        expiredCorpses !== null ||
                        zombieSave !== null ||
                        positionSave !== null ||
                        isCombatChanged ||
                        timerSave !== null
                    )
                        store.saveCombat(
                            nextCombat,
                            itemSave ?? undefined,
                            deathPosition,
                            isDying || expiredCorpses !== null ? nextCorpses : undefined,
                            zombieSave ?? undefined,
                            positionSave ?? undefined,
                            worldProgress,
                        );
                    else if (itemSave !== null) store.saveItemLocations(itemSave, worldProgress);

                    if (itemSave !== null) {
                        this.pickup.confirmSave();
                    }

                    this.lootTimers.confirmSave();
                    corpses = nextCorpses;
                    this.pickup.setCorpses(corpses);
                    savedCombat = nextCombat;
                    if (zombieSave !== null) this.zombie.confirmHealthSave();
                    if (positionSave !== null) this.zombie.confirmPositionSave();
                    this.offlineVulnerabilityTicks = nextCombat.logoutVulnerabilityTicks ?? 0;
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

        if (playerId === this.access?.soloPlayerId && this.offlineVulnerabilityTicks > 0) {
            this.pendingStep?.();
            if (this.isStopping || this.save?.(0) === false)
                throw new Error('Failed to save the returning player.');
            this.offlineVulnerabilityTicks = 0;
        }
        this.movement?.join(client.sessionId, playerId);
        this.pickup.initializePlayer(playerId);
        this.movement?.setCarriedWeight(playerId, this.pickup.weightGrams(playerId));
    }

    override onLeave(client: Client): void {
        this.movement?.leave(client.sessionId);
        this.pickup.leave(client.sessionId);
        this.melee.leave(client.sessionId);
        this.firearm.leave(client.sessionId);
        this.reload.leave(client.sessionId);

        const playerId: unknown = client.auth;
        if (
            typeof playerId !== 'string' ||
            playerId !== this.access?.soloPlayerId ||
            this.movement?.isPlayerConnected(playerId) === true
        ) {
            return;
        }

        this.pendingStep?.();
        if (this.isStopping) return;

        const isInCombat =
            this.combat.remainingCombatTicks(playerId) > 0 ||
            this.combat.bleedingTicks(playerId) > 0;
        const logoutVulnerabilityTicks =
            isInCombat && this.combat.health(playerId) > 0
                ? combatSettings.logoutVulnerabilityTicks
                : 0;
        if (
            (logoutVulnerabilityTicks === 0
                ? this.save?.()
                : this.save?.(logoutVulnerabilityTicks)) === false
        )
            return;

        this.offlineVulnerabilityTicks = logoutVulnerabilityTicks;
        if (logoutVulnerabilityTicks === 0) this.movement?.hideDisconnectedSoloPlayer();
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
