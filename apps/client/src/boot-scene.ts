import type { PlayerMovementState } from '@zombi-survive/domain';
import { type GameObjects, Scene } from 'phaser';

const pixelsPerMeter = 24;

export class BootScene extends Scene {
    private player: PlayerMovementState | null = null;
    private marker: GameObjects.Container | null = null;

    constructor() {
        super('boot');
    }

    create(): void {
        const grid = this.add.graphics().lineStyle(1, 0x293b2e);

        for (let x = 0; x <= 960; x += pixelsPerMeter) {
            grid.lineBetween(x, 0, x, 540);
        }

        for (let y = 270 % pixelsPerMeter; y <= 540; y += pixelsPerMeter) {
            grid.lineBetween(0, y, 960, y);
        }

        grid.lineStyle(2, 0x50614a).lineBetween(480, 0, 480, 540).lineBetween(0, 270, 960, 270);
        this.marker = this.add.container(480, 270, [
            this.add.ellipse(0, 8, 24, 10, 0x0b100e),
            this.add.rectangle(0, 1, 16, 18, 0x88a76d),
            this.add.rectangle(0, -11, 10, 10, 0xddc7a0),
        ]);
        this.setPlayer(this.player);
        this.game.canvas.dataset['sceneReady'] = 'true';
        this.game.canvas.setAttribute('aria-label', 'Игровое поле ZombiSurvive');
    }

    setPlayer(player: PlayerMovementState | null): void {
        this.player = player;

        if (this.marker === null) {
            return;
        }

        this.marker.setVisible(player !== null);
        this.game.canvas.dataset['playerVisible'] = String(player !== null);

        if (player !== null) {
            const x = 480 + player.position.xMeters * pixelsPerMeter;
            const y = 270 + player.position.yMeters * pixelsPerMeter;
            this.marker.setPosition(x, y);
            this.game.canvas.dataset['playerX'] = String(x);
            this.game.canvas.dataset['playerY'] = String(y);
        }
    }
}
