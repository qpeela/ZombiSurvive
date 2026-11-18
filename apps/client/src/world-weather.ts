import { worldClockSettings, type WorldWeather } from '@zombi-survive/content';
import type { GameObjects, Scene } from 'phaser';

/** Bounded, camera-local rain; Graphics is reused and cleared on disconnect/shutdown. */
export class WorldWeatherVisual {
    private readonly graphics: GameObjects.Graphics;
    private readonly scene: Scene;
    private signature = '';

    constructor(scene: Scene) {
        this.scene = scene;
        this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(11);
    }

    draw(weather: WorldWeather | null, worldTimeMs: number): void {
        const { width, height } = this.scene.scale;
        const signature = [weather, worldTimeMs, width, height].join(',');
        if (signature === this.signature) return;

        this.signature = signature;
        this.graphics.clear();
        this.scene.game.canvas.dataset['weather'] = weather ?? 'unknown';
        if (weather !== 'rain') return;

        this.graphics.fillStyle(0x607a94, 0.09).fillRect(0, 0, width, height);
        this.graphics.lineStyle(1, 0xb8d6e8, 0.5);
        const elapsedMs = worldTimeMs / worldClockSettings.timeScale;
        const progress = (elapsedMs % 900) / 900;
        for (let index = 0; index < 96; index++) {
            const x = ((index * 137 + progress * 55) % (width + 32)) - 16;
            const y = ((index * 83 + progress * height) % (height + 32)) - 16;
            this.graphics.lineBetween(x, y, x - 5, y + 16);
        }
    }

    destroy(): void {
        this.graphics.destroy();
        delete this.scene.game.canvas.dataset['weather'];
    }
}
