import { type DaylightPhase, itemDisplayName, type WorldWeather } from '@zombi-survive/content';
import {
    type Corpse,
    type GroundItem,
    isMeleeWeaponId,
    type PlayerMovementState,
    type WeaponId,
    type WorldPosition,
    type ZombieState,
} from '@zombi-survive/domain';
import type { MeleeAction, ShotAction, ShotAim } from '@zombi-survive/protocol';
import { isPositionVisible, resolveMovement } from '@zombi-survive/simulation';
import { GameObjects, type Input, Scene } from 'phaser';

import { CharacterVisual } from './character-visual';
import { drawHeldWeapon, heldWeaponGrip } from './held-weapon';
import { MeleeAnimation } from './melee-animation';
import { meleeEffectDurationMs, MeleeFeedback } from './melee-feedback';
import { shotEffectDurationMs, ShotFeedback } from './shot-feedback';
import { WorldLighting } from './world-lighting';
import { WorldTerrain } from './world-terrain';
import { WorldWeatherVisual } from './world-weather';

const pixelsPerMeter = 24;

export class BootScene extends Scene {
    private weather: WorldWeather | null = null;
    private weatherTimeMs = 0;
    private weatherVisual: WorldWeatherVisual | null = null;
    private daylightPhase: DaylightPhase | null = null;
    private lighting: WorldLighting | null = null;
    private player: PlayerMovementState | null = null;
    private isAlive = false;
    private marker: GameObjects.Container | null = null;
    private character: CharacterVisual | null = null;
    private weaponReach = 0;
    private weapon: WeaponId | null = null;
    private weaponImage: GameObjects.Graphics | null = null;
    private facingAngle = 0;
    private isFlashlightOn = false;
    private readonly animation = new MeleeAnimation();
    private readonly shots = new ShotFeedback();
    private readonly shotVisuals = new Map<
        string,
        { tracer: GameObjects.Graphics; text: GameObjects.Text }
    >();
    private readonly feedback = new MeleeFeedback();
    private readonly effects = new Map<number, { text: GameObjects.Text; ring: GameObjects.Arc }>();
    private otherPlayers: readonly PlayerMovementState[] = [];
    private readonly otherMarkers = new Map<string, CharacterVisual>();
    private zombies: readonly ZombieState[] = [];
    private readonly zombieMarkers = new Map<string, CharacterVisual>();
    private terrain: WorldTerrain | null = null;

    private corpses: readonly Corpse[] = [];
    private readonly corpseMarkers = new Map<string, GameObjects.Container>();
    private groundItem: GroundItem | null = null;
    private itemMarker: GameObjects.Container | null = null;
    private grid: GameObjects.Graphics | null = null;
    private aim: GameObjects.Graphics | null = null;
    private crosshair: GameObjects.Graphics | null = null;
    private destinationMarker: GameObjects.Graphics | null = null;
    private destination: WorldPosition | null = null;
    private visibilitySignature = '';
    onVisibilityChange: () => void = () => {};
    onFrame: () => void = () => {};
    onShoot: (aim: ShotAim) => void = () => {};
    onMove: (position: WorldPosition) => void = () => {};

    constructor() {
        super('boot');
    }

    create(): void {
        this.terrain = new WorldTerrain(this);
        this.lighting = new WorldLighting(this);
        this.weatherVisual = new WorldWeatherVisual(this);
        this.lighting.setPhase(this.daylightPhase);
        this.grid = this.add.graphics();
        this.aim = this.add
            .graphics()
            .lineStyle(2, 0xe3bb70)
            .lineBetween(14, 0, 32, 0)
            .lineBetween(32, 0, 26, -5)
            .lineBetween(32, 0, 26, 5)
            .setDepth(2);
        this.crosshair = this.add
            .graphics()
            .lineStyle(1, 0xe3bb70)
            .strokeCircle(0, 0, 7)
            .lineBetween(-11, 0, -4, 0)
            .lineBetween(4, 0, 11, 0)
            .lineBetween(0, -11, 0, -4)
            .lineBetween(0, 4, 0, 11)
            .setScrollFactor(0)
            .setDepth(3);
        this.destinationMarker = this.add
            .graphics()
            .lineStyle(2, 0x88a76d)
            .strokeCircle(0, 0, 9)
            .lineBetween(-4, 0, 4, 0)
            .lineBetween(0, -4, 0, 4)
            .setDepth(1);
        const onPointerDown = (pointer: Input.Pointer): void => {
            const event = pointer.event;
            const isModified = event.altKey || event.metaKey;

            if (this.player !== null && pointer.button === 2 && !isModified) {
                const camera = this.cameras.main;
                const x = pointer.x + camera.scrollX - (this.marker?.x ?? 480);
                const y = pointer.y + camera.scrollY - (this.marker?.y ?? 270);
                this.onShoot({ x, y });
                return;
            }
            if (this.player === null || pointer.button !== 0 || isModified) {
                return;
            }

            const camera = this.cameras.main;
            this.onMove({
                xMeters: (pointer.x + camera.scrollX - 480) / pixelsPerMeter,
                yMeters: (pointer.y + camera.scrollY - 270) / pixelsPerMeter,
            });
        };
        const onContextMenu = (event: MouseEvent): void => {
            if (this.player !== null && (event.ctrlKey || this.weapon === 'pistol')) {
                event.preventDefault();
            }
        };
        const onPointerPosition = (): void => {
            // HTML UI reflow can move the canvas without a window resize.
            this.game.scale.updateBounds();
        };
        const onScaleResize = (): void => {
            const pointer = this.input.activePointer;
            const event = pointer.event;

            if (this.input.manager.isOver && event instanceof MouseEvent) {
                this.input.manager.transformPointer(pointer, event.pageX, event.pageY, false);
                if (this.player !== null && this.isAlive) this.updateAim(pointer);
            }
        };
        this.game.canvas.addEventListener('mousemove', onPointerPosition, true);
        this.game.canvas.addEventListener('mousedown', onPointerPosition, true);
        this.game.canvas.addEventListener('contextmenu', onContextMenu);
        this.input.on('pointerdown', onPointerDown);
        this.scale.on('resize', onScaleResize);
        this.itemMarker = this.add
            .container(0, 0, [
                this.add.rectangle(0, 0, 18, 12, 0xe0d6bd).setStrokeStyle(2, 0x8f846b),
                this.add
                    .text(0, -24, 'Бинт', {
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        color: '#e0d6bd',
                    })
                    .setOrigin(0.5),
            ])
            .setDepth(1);
        this.setGroundItem(this.groundItem);
        this.setCorpses(this.corpses);
        this.setZombies(this.zombies);
        this.character = new CharacterVisual({ scene: this, id: 'local-player', kind: 'player' });
        this.marker = this.character.root;
        this.weaponImage = this.add.graphics().setDepth(2);
        drawHeldWeapon(this.weaponImage, this.weapon);
        this.updateWeapon();
        this.setPlayers(this.player, this.otherPlayers);
        this.events.once('shutdown', () => {
            this.input.off('pointerdown', onPointerDown);
            this.scale.off('resize', onScaleResize);
            this.game.canvas.removeEventListener('mousemove', onPointerPosition, true);
            this.game.canvas.removeEventListener('mousedown', onPointerPosition, true);
            this.game.canvas.removeEventListener('contextmenu', onContextMenu);
            this.weatherVisual?.destroy();
            this.weatherVisual = null;
            this.lighting?.destroy();
            this.lighting = null;
            this.terrain?.destroy();
            this.terrain = null;
            this.grid = null;
            this.aim = null;
            this.crosshair = null;
            this.destinationMarker = null;
            this.marker = null;
            this.character = null;
            this.game.canvas.dataset['playerCharacter'] = 'null';
            this.game.canvas.dataset['zombieCharacters'] = '[]';
            this.game.canvas.dataset['visibleZombies'] = '[]';
            this.game.canvas.dataset['groundItemVisible'] = 'false';
            this.game.canvas.dataset['otherCharacters'] = '[]';
            this.feedback.clear();
            this.clearShots();
            this.clearEffects();
            this.animation.setWeapon(null);
            this.weaponImage = null;
            this.game.canvas.dataset['weaponAnimation'] = 'idle';
            this.game.canvas.dataset['weaponVisible'] = 'false';
            delete this.game.canvas.dataset['weapon'];
            this.itemMarker = null;
            this.otherMarkers.clear();
            this.zombieMarkers.clear();
            this.corpseMarkers.clear();
        });
        this.game.canvas.dataset['sceneReady'] = 'true';
        this.game.canvas.setAttribute('aria-label', 'Игровое поле ZombiSurvive');
    }

    setWeather(weather: WorldWeather | null, worldTimeMs: number): void {
        this.weather = weather;
        this.weatherTimeMs = worldTimeMs;
    }

    setDaylightPhase(phase: DaylightPhase | null): void {
        if (phase === this.daylightPhase) return;

        this.daylightPhase = phase;
        this.lighting?.setPhase(phase);
    }

    setFlashlight(isEnabled: boolean): void {
        this.isFlashlightOn = isEnabled;
    }

    canSee(position: WorldPosition): boolean {
        return isPositionVisible({
            observer: this.player?.position ?? null,
            target: position,
            phase: this.daylightPhase,
            weather: this.weather,
            obstacles: this.terrain?.obstacles ?? [],
            ...(this.isFlashlightOn && this.isAlive
                ? { flashlight: { angleRadians: this.facingAngle } }
                : {}),
        });
    }

    canReachLoot(from: WorldPosition, to: WorldPosition): boolean {
        if (this.terrain === null) return false;

        const reached = resolveMovement(from, to, this.terrain.obstacles);

        return Math.hypot(reached.xMeters - to.xMeters, reached.yMeters - to.yMeters) < 1e-8;
    }

    private updateVisibility(): void {
        const visibleZombies: string[] = [];
        for (const [id, marker] of this.zombieMarkers) {
            const isVisible = this.canSee({
                xMeters: (marker.root.x - 480) / pixelsPerMeter,
                yMeters: (marker.root.y - 270) / pixelsPerMeter,
            });
            marker.root.setVisible(isVisible);
            if (isVisible) visibleZombies.push(id);
        }
        for (const marker of this.otherMarkers.values())
            marker.root.setVisible(
                this.canSee({
                    xMeters: (marker.root.x - 480) / pixelsPerMeter,
                    yMeters: (marker.root.y - 270) / pixelsPerMeter,
                }),
            );
        const visibleCorpses = this.corpses.filter(corpse => this.canSee(corpse.position));
        const corpseIds = new Set(visibleCorpses.map(corpse => corpse.corpseId));
        for (const [id, marker] of this.corpseMarkers) marker.setVisible(corpseIds.has(id));
        const isGroundVisible = this.groundItem !== null && this.canSee(this.groundItem.position);
        this.itemMarker?.setVisible(isGroundVisible);
        const canvas = this.game.canvas;
        canvas.dataset['visibleZombies'] = JSON.stringify(visibleZombies);
        canvas.dataset['groundItemVisible'] = String(isGroundVisible);
        const signature = JSON.stringify([isGroundVisible, ...corpseIds]);
        if (signature === this.visibilitySignature) return;

        this.visibilitySignature = signature;
        this.onVisibilityChange();
    }

    setZombies(zombies: readonly ZombieState[]): void {
        this.zombies = zombies;

        if (this.terrain === null) {
            return;
        }

        const ids = new Set(zombies.map(zombie => zombie.zombieId));

        for (const [id, marker] of this.zombieMarkers) {
            if (!ids.has(id)) {
                marker.destroy();
                this.zombieMarkers.delete(id);
            }
        }

        for (const zombie of zombies) {
            const marker =
                this.zombieMarkers.get(zombie.zombieId) ??
                new CharacterVisual({
                    scene: this,
                    id: zombie.zombieId,
                    kind: 'zombie',
                });
            marker.setTarget({
                position: zombie.position,
                isPursuing: zombie.targetPlayerId !== null,
            });
            this.zombieMarkers.set(zombie.zombieId, marker);
        }

        this.game.canvas.dataset['zombies'] = JSON.stringify(zombies);
    }

    setCorpses(corpses: readonly Corpse[]): void {
        this.corpses = corpses;
        if (this.terrain === null) return;
        const ids = new Set(corpses.map(corpse => corpse.corpseId));
        for (const [id, marker] of this.corpseMarkers) {
            if (!ids.has(id)) {
                marker.destroy();
                this.corpseMarkers.delete(id);
            }
        }
        for (const corpse of corpses) {
            const marker =
                this.corpseMarkers.get(corpse.corpseId) ??
                this.add
                    .container(0, 0, [
                        this.add.rectangle(0, 0, 30, 14, 0x684a42),
                        this.add.rectangle(-18, 0, 10, 10, 0xab9479),
                        this.add
                            .text(0, -25, 'Тело', {
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                color: '#c5a691',
                            })
                            .setOrigin(0.5),
                    ])
                    .setDepth(1);
            marker.setPosition(
                480 + corpse.position.xMeters * pixelsPerMeter,
                270 + corpse.position.yMeters * pixelsPerMeter,
            );
            this.corpseMarkers.set(corpse.corpseId, marker);
        }
        this.game.canvas.dataset['corpses'] = JSON.stringify(corpses);
    }

    setGroundItem(item: GroundItem | null): void {
        this.groundItem = item;
        this.itemMarker?.setVisible(item !== null);

        if (item !== null) {
            const label = this.itemMarker?.list[1];
            if (label instanceof GameObjects.Text) label.setText(itemDisplayName(item));
            this.itemMarker?.setPosition(
                480 + item.position.xMeters * pixelsPerMeter,
                270 + item.position.yMeters * pixelsPerMeter,
            );
        }
    }

    setWeapon(weapon: WeaponId | null): void {
        const isChanged = this.weapon !== weapon;
        this.weapon = weapon;
        this.animation.setWeapon(isMeleeWeaponId(weapon) ? weapon : null);

        if (this.weaponImage !== null && isChanged) {
            drawHeldWeapon(this.weaponImage, weapon);
        }

        this.updateWeapon();
    }

    playAttack(action: MeleeAction): void {
        this.feedback.accept(action);

        if (this.animation.accept(action)) {
            this.updateWeapon();
        }
    }

    aimDirection(): ShotAim {
        return { x: Math.cos(this.facingAngle), y: Math.sin(this.facingAngle) };
    }

    playShot(action: ShotAction): void {
        if (this.player !== null) this.shots.accept(action);
    }

    private clearShots(): void {
        this.shots.clear();
        for (const visual of this.shotVisuals.values()) {
            visual.tracer.destroy();
            visual.text.destroy();
        }
        this.shotVisuals.clear();
        this.game.canvas.dataset['shotEffects'] = '[]';
    }

    private updateShots(deltaMs: number): void {
        this.shots.advance(deltaMs);
        const retained = new Set(this.shots.effects.map(effect => effect.key));
        for (const [key, visual] of this.shotVisuals) {
            if (!retained.has(key)) {
                visual.tracer.destroy();
                visual.text.destroy();
                this.shotVisuals.delete(key);
            }
        }
        for (const effect of this.shots.effects) {
            const { origin, impact } = effect.action;
            const x = 480 + impact.position.xMeters * pixelsPerMeter;
            const y = 270 + impact.position.yMeters * pixelsPerMeter;
            let visual = this.shotVisuals.get(effect.key);
            if (visual === undefined) {
                const label =
                    impact.outcome === 'miss'
                        ? 'Промах'
                        : `−${String(impact.damage)}${impact.outcome === 'kill' ? ' · Убит' : ''}`;
                visual = {
                    tracer: this.add
                        .graphics()
                        .setDepth(5)
                        .lineStyle(2, 0xffe2a0)
                        .lineBetween(
                            480 + origin.xMeters * pixelsPerMeter,
                            270 + origin.yMeters * pixelsPerMeter,
                            x,
                            y,
                        )
                        .fillStyle(0xffd16b)
                        .fillCircle(
                            480 + origin.xMeters * pixelsPerMeter,
                            270 + origin.yMeters * pixelsPerMeter,
                            9,
                        ),
                    text: this.add
                        .text(x, y - 25, label, {
                            fontFamily: 'monospace',
                            fontSize: '14px',
                            color: '#ffe2a0',
                            backgroundColor: '#111a14',
                        })
                        .setOrigin(0.5)
                        .setDepth(5),
                };
                this.shotVisuals.set(effect.key, visual);
            }
            visual.tracer.setAlpha(Math.max(0, 1 - effect.ageMs / 180));
            visual.text.setAlpha(1 - effect.ageMs / shotEffectDurationMs);
            visual.text.setVisible(this.canSee(impact.position));
            visual.tracer.setVisible(this.canSee(impact.position));
        }
        this.game.canvas.dataset['shotEffects'] = JSON.stringify(this.shots.effects);
    }

    private clearEffects(): void {
        for (const effect of this.effects.values()) {
            effect.text.destroy();
            effect.ring.destroy();
        }

        this.effects.clear();
        this.game.canvas.dataset['meleeEffects'] = '[]';
    }

    private updateFeedback(deltaMs: number): void {
        this.feedback.advance({
            deltaMs,
            isLoaded: position => this.terrain?.contains(position) ?? false,
        });
        const retained = new Set(this.feedback.effects.map(effect => effect.tick));

        for (const [tick, effect] of this.effects) {
            if (!retained.has(tick)) {
                effect.text.destroy();
                effect.ring.destroy();
                this.effects.delete(tick);
            }
        }

        for (const marker of this.zombieMarkers.values()) {
            marker.root.setAlpha(1);
        }

        for (const effect of this.feedback.effects) {
            const { impact } = effect;
            const x = 480 + impact.position.xMeters * pixelsPerMeter;
            const y = 270 + impact.position.yMeters * pixelsPerMeter;
            let visuals = this.effects.get(effect.tick);

            if (visuals === undefined) {
                const colors = { miss: 0xadb9a5, hit: 0xe7a07b, kill: 0xf3d16b };
                const color = colors[impact.outcome];
                const suffix = impact.outcome === 'kill' ? ' · Убит' : '';
                const label =
                    impact.outcome === 'miss' ? 'Промах' : `−${String(impact.damage)}${suffix}`;
                visuals = {
                    text: this.add
                        .text(x, y - 25, label, {
                            fontFamily: 'monospace',
                            fontSize: '14px',
                            color: '#ffffff',
                            backgroundColor: '#111a14',
                        })
                        .setOrigin(0.5)
                        .setDepth(5),
                    ring: this.add
                        .circle(x, y, 15, color, 0.2)
                        .setStrokeStyle(2, color)
                        .setDepth(4),
                };
                this.effects.set(effect.tick, visuals);
            }

            visuals.text.setVisible(this.canSee(impact.position));
            visuals.ring.setVisible(this.canSee(impact.position));
            const progress = effect.ageMs / meleeEffectDurationMs;
            visuals.text.setPosition(x, y - 25 - progress * 20).setAlpha(1 - progress);
            visuals.ring.setScale(1 + progress).setAlpha(1 - progress);

            if (impact.outcome === 'hit' && effect.ageMs < 150) {
                this.zombieMarkers.get(impact.zombieId)?.root.setAlpha(0.4);
            }
        }

        this.game.canvas.dataset['meleeEffects'] = JSON.stringify(this.feedback.effects);
    }

    private updateWeapon(deltaMs = 0): void {
        const image = this.weaponImage;

        if (image === null) {
            return;
        }

        const isPlayerVisible = this.player !== null && this.marker !== null && this.isAlive;
        image.setVisible(isPlayerVisible && this.weapon !== null);

        const pose = this.animation.advance(deltaMs);
        this.weaponReach = pose.reach;

        if (this.marker !== null) {
            image
                .setPosition(
                    this.marker.x + Math.cos(this.facingAngle) * pose.reach,
                    this.marker.y + Math.sin(this.facingAngle) * pose.reach,
                )
                .setRotation(this.facingAngle + pose.rotation);
        }

        const canvas = this.game.canvas;
        canvas.dataset['weaponAnimation'] = pose.phase;
        canvas.dataset['weaponAttackTick'] = String(this.animation.tick);
        canvas.dataset['weaponVisible'] = String(image.visible);
        canvas.dataset['weapon'] = this.weapon ?? '';
        canvas.dataset['weaponX'] = String(image.x);
        canvas.dataset['weaponY'] = String(image.y);
        canvas.dataset['weaponAngle'] = String(image.rotation);
    }

    setDestination(position: WorldPosition | null): void {
        this.destination = position;
    }

    private updateAim(pointer: Input.Pointer): void {
        const marker = this.marker;

        if (marker === null) {
            return;
        }

        const camera = this.cameras.main;
        const x = pointer.x + camera.scrollX;
        const y = pointer.y + camera.scrollY;
        const angle = Math.atan2(y - marker.y, x - marker.x);
        this.facingAngle = angle;
        this.aim?.setPosition(marker.x, marker.y).setRotation(angle);
        this.crosshair?.setPosition(pointer.x, pointer.y);
        const canvas = this.game.canvas;
        canvas.dataset['aimAngle'] = String(angle);
        canvas.dataset['aimX'] = String((x - 480) / pixelsPerMeter);
        canvas.dataset['aimY'] = String((y - 270) / pixelsPerMeter);
    }

    override update(_time: number, deltaMs: number): void {
        this.onFrame();
        const camera = this.cameras.main;
        const canvas = this.game.canvas;
        const pointer = this.input.activePointer;
        const isAiming = this.player !== null && this.isAlive && this.input.manager.isOver;
        const isEmptyHands = this.weapon === null;
        this.aim?.setVisible(isAiming && isEmptyHands);
        this.crosshair?.setVisible(isAiming);
        const hasDestination = this.destination !== null && this.player !== null;
        this.destinationMarker?.setVisible(hasDestination);
        canvas.dataset['targetVisible'] = String(hasDestination);
        canvas.dataset['aimVisible'] = String(isAiming);
        canvas.dataset['cameraX'] = String(camera.scrollX);
        canvas.dataset['cameraY'] = String(camera.scrollY);

        if (this.destination !== null) {
            this.destinationMarker?.setPosition(
                480 + this.destination.xMeters * pixelsPerMeter,
                270 + this.destination.yMeters * pixelsPerMeter,
            );
            canvas.dataset['targetX'] = String(this.destination.xMeters);
            canvas.dataset['targetY'] = String(this.destination.yMeters);
        } else {
            delete canvas.dataset['targetX'];
            delete canvas.dataset['targetY'];
        }

        if (isAiming) {
            this.updateAim(pointer);
        }

        this.lighting?.draw({
            position: this.player?.position ?? null,
            angleRadians: this.facingAngle,
            isFlashlightOn: this.isFlashlightOn && this.isAlive,
            weather: this.weather,
            obstacles: this.terrain?.obstacles ?? [],
        });
        this.weatherVisual?.draw(this.weather, this.weatherTimeMs);
        this.updateWeapon(deltaMs);
        this.updateCharacters(deltaMs);
        this.updateFeedback(deltaMs);
        this.updateShots(deltaMs);

        // Only the visible grid is drawn; moving away from the origin never exhausts it.
        const grid = this.grid;

        if (grid === null) {
            return;
        }

        grid.clear().lineStyle(1, 0x293b2e, 0.4);
        const left = Math.floor((camera.scrollX - 480) / pixelsPerMeter) * pixelsPerMeter + 480;
        const top = Math.floor((camera.scrollY - 270) / pixelsPerMeter) * pixelsPerMeter + 270;

        for (let x = left; x <= camera.scrollX + camera.width; x += pixelsPerMeter) {
            grid.lineBetween(x, camera.scrollY, x, camera.scrollY + camera.height);
        }

        for (let y = top; y <= camera.scrollY + camera.height; y += pixelsPerMeter) {
            grid.lineBetween(camera.scrollX, y, camera.scrollX + camera.width, y);
        }

        grid.lineStyle(2, 0x50614a)
            .lineBetween(480, camera.scrollY, 480, camera.scrollY + camera.height)
            .lineBetween(camera.scrollX, 270, camera.scrollX + camera.width, 270);
    }

    private updateCharacters(deltaMs: number): void {
        const image = this.weaponImage;
        let weaponHand: { x: number; y: number } | undefined;

        if (image !== null && image.visible && this.marker !== null) {
            const cosine = Math.cos(image.rotation);
            const sine = Math.sin(image.rotation);
            weaponHand = {
                x: image.x - this.marker.x + cosine * heldWeaponGrip.x - sine * heldWeaponGrip.y,
                y: image.y - this.marker.y + sine * heldWeaponGrip.x + cosine * heldWeaponGrip.y,
            };
        }

        this.character?.advance({
            deltaMs,
            facingAngle: this.facingAngle,
            ...(weaponHand === undefined ? {} : { weaponHand }),
            reach: this.weaponReach,
        });
        for (const marker of this.otherMarkers.values()) marker.advance({ deltaMs });
        for (const marker of this.zombieMarkers.values()) marker.advance({ deltaMs });

        this.updateVisibility();
        const canvas = this.game.canvas;
        canvas.dataset['playerCharacter'] = JSON.stringify(
            this.player === null || !this.isAlive ? null : this.character?.snapshot(),
        );
        canvas.dataset['otherCharacters'] = JSON.stringify(
            [...this.otherMarkers.values()]
                .filter(marker => marker.root.visible)
                .map(marker => marker.snapshot()),
        );
        canvas.dataset['zombieCharacters'] = JSON.stringify(
            [...this.zombieMarkers.values()]
                .filter(marker => marker.root.visible)
                .map(marker => marker.snapshot()),
        );
    }

    setAlive(isAlive: boolean): void {
        this.isAlive = isAlive;
        if (!isAlive) this.character?.reset();
    }

    setPlayer(player: PlayerMovementState | null): void {
        this.player = player;

        if (this.marker === null) {
            return;
        }

        this.terrain?.update(player?.position ?? null);
        this.marker.setVisible(player !== null && this.isAlive);
        this.game.canvas.dataset['playerVisible'] = String(player !== null && this.isAlive);

        if (player === null) {
            this.character?.reset();
            this.feedback.clear();
            this.clearShots();
            this.clearEffects();
            this.facingAngle = 0;
            this.updateWeapon();
        }

        if (player !== null) {
            const x = 480 + player.position.xMeters * pixelsPerMeter;
            const y = 270 + player.position.yMeters * pixelsPerMeter;
            if (this.isAlive) {
                this.character?.setTarget({
                    position: player.position,
                    isSneaking: player.isSneaking,
                });
            } else {
                this.character?.reset();
            }
            this.cameras.main.centerOn(x, y);
            this.game.canvas.dataset['playerX'] = String(x);
            this.game.canvas.dataset['playerY'] = String(y);
        }
    }

    setPlayers(
        player: PlayerMovementState | null,
        otherPlayers: readonly PlayerMovementState[],
    ): void {
        this.otherPlayers = otherPlayers;
        this.setPlayer(player);

        if (this.marker === null) {
            return;
        }

        const ids = new Set(otherPlayers.map(other => other.playerId));

        for (const [id, marker] of this.otherMarkers) {
            if (!ids.has(id)) {
                marker.destroy();
                this.otherMarkers.delete(id);
            }
        }

        for (const other of otherPlayers) {
            const marker =
                this.otherMarkers.get(other.playerId) ??
                new CharacterVisual({
                    scene: this,
                    id: other.playerId,
                    kind: 'other',
                });
            marker.setTarget({ position: other.position, isSneaking: other.isSneaking });
            this.otherMarkers.set(other.playerId, marker);
        }

        this.game.canvas.dataset['otherPlayers'] = JSON.stringify(otherPlayers);
    }
}
