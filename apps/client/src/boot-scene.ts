import type { GroundItem, PlayerMovementState, WorldPosition } from '@zombi-survive/domain';
import { type GameObjects, type Input, Scene } from 'phaser';

import { WorldTerrain } from './world-terrain';

const pixelsPerMeter = 24;

export class BootScene extends Scene {
    private player: PlayerMovementState | null = null;
    private marker: GameObjects.Container | null = null;
    private otherPlayers: readonly PlayerMovementState[] = [];
    private readonly otherMarkers = new Map<string, GameObjects.Container>();
    private terrain: WorldTerrain | null = null;

    private groundItem: GroundItem | null = null;
    private itemMarker: GameObjects.Container | null = null;
    private grid: GameObjects.Graphics | null = null;
    private aim: GameObjects.Graphics | null = null;
    private crosshair: GameObjects.Graphics | null = null;
    private destinationMarker: GameObjects.Graphics | null = null;
    private destination: WorldPosition | null = null;
    onFrame: () => void = () => {};
    onMove: (position: WorldPosition) => void = () => {};

    constructor() {
        super('boot');
    }

    create(): void {
        this.terrain = new WorldTerrain(this);
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
            if (event.ctrlKey && this.player !== null) {
                event.preventDefault();
            }
        };
        this.game.canvas.addEventListener('contextmenu', onContextMenu);
        this.input.on('pointerdown', onPointerDown);
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
        this.marker = this.createMarker(true);
        this.setPlayers(this.player, this.otherPlayers);
        this.events.once('shutdown', () => {
            this.input.off('pointerdown', onPointerDown);
            this.game.canvas.removeEventListener('contextmenu', onContextMenu);
            this.terrain?.destroy();
            this.terrain = null;
            this.grid = null;
            this.aim = null;
            this.crosshair = null;
            this.destinationMarker = null;
            this.marker = null;
            this.itemMarker = null;
            this.otherMarkers.clear();
        });
        this.game.canvas.dataset['sceneReady'] = 'true';
        this.game.canvas.setAttribute('aria-label', 'Игровое поле ZombiSurvive');
    }

    setGroundItem(item: GroundItem | null): void {
        this.groundItem = item;
        this.itemMarker?.setVisible(item !== null);

        if (item !== null) {
            this.itemMarker?.setPosition(
                480 + item.position.xMeters * pixelsPerMeter,
                270 + item.position.yMeters * pixelsPerMeter,
            );
        }
    }

    setDestination(position: WorldPosition | null): void {
        this.destination = position;
    }

    override update(): void {
        this.onFrame();
        const camera = this.cameras.main;
        const canvas = this.game.canvas;
        const pointer = this.input.activePointer;
        const isAiming = this.player !== null && this.input.manager.isOver;
        this.aim?.setVisible(isAiming);
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

        if (this.marker !== null && isAiming) {
            const x = pointer.x + camera.scrollX;
            const y = pointer.y + camera.scrollY;
            const angle = Math.atan2(y - this.marker.y, x - this.marker.x);
            this.aim?.setPosition(this.marker.x, this.marker.y).setRotation(angle);
            this.crosshair?.setPosition(pointer.x, pointer.y);
            canvas.dataset['aimAngle'] = String(angle);
            canvas.dataset['aimX'] = String((x - 480) / pixelsPerMeter);
            canvas.dataset['aimY'] = String((y - 270) / pixelsPerMeter);
        }

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

    private createMarker(isLocal: boolean): GameObjects.Container {
        return this.add.container(480, 270, [
            this.add.ellipse(0, 8, 24, 10, 0x0b100e),
            this.add.rectangle(0, 1, 16, 18, isLocal ? 0x88a76d : 0x71a5cf),
            this.add.rectangle(0, -11, 10, 10, 0xddc7a0),
            this.add
                .text(0, -36, isLocal ? 'Вы' : 'Друг', {
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    color: '#d8e3c9',
                })
                .setOrigin(0.5),
        ]);
    }

    setPlayer(player: PlayerMovementState | null): void {
        this.player = player;

        if (this.marker === null) {
            return;
        }

        this.terrain?.update(player?.position ?? null);
        this.marker.setVisible(player !== null);
        this.game.canvas.dataset['playerVisible'] = String(player !== null);

        if (player !== null) {
            const x = 480 + player.position.xMeters * pixelsPerMeter;
            const y = 270 + player.position.yMeters * pixelsPerMeter;
            this.marker.setPosition(x, y).setScale(1, player.isSneaking ? 0.75 : 1);
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
            const marker = this.otherMarkers.get(other.playerId) ?? this.createMarker(false);
            marker.setPosition(
                480 + other.position.xMeters * pixelsPerMeter,
                270 + other.position.yMeters * pixelsPerMeter,
            );
            marker.setScale(1, other.isSneaking ? 0.75 : 1);
            this.otherMarkers.set(other.playerId, marker);
        }

        this.game.canvas.dataset['otherPlayers'] = JSON.stringify(otherPlayers);
    }
}
