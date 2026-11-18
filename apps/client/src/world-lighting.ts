import { type DaylightPhase, daylightPhases } from '@zombi-survive/content';
import type { GameObjects, Scene } from 'phaser';

/** Camera-local tint leaves HTML HUD readable and follows the authoritative phase. */
export class WorldLighting {
    private readonly overlay: GameObjects.Graphics;
    private readonly scene: Scene;

    constructor(scene: Scene) {
        this.scene = scene;
        this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(10);
    }

    setPhase(phase: DaylightPhase | null): void {
        this.overlay.clear();
        this.scene.game.canvas.dataset['daylightPhase'] = phase ?? 'unknown';
        this.scene.game.canvas.dataset['daylightOpacity'] = String(
            phase === null ? 0 : daylightPhases[phase].opacity,
        );
        if (phase === null) return;

        const settings = daylightPhases[phase];
        this.overlay
            .fillStyle(settings.color, settings.opacity)
            .fillRect(0, 0, this.scene.scale.width, this.scene.scale.height);
    }

    destroy(): void {
        this.overlay.destroy();
        delete this.scene.game.canvas.dataset['daylightPhase'];
        delete this.scene.game.canvas.dataset['daylightOpacity'];
    }
}
