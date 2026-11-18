import { type DaylightPhase, daylightPhases, flashlightSettings } from '@zombi-survive/content';
import type { WorldPosition } from '@zombi-survive/domain';
import { isWithinFlashlightAngle } from '@zombi-survive/simulation';
import type { GameObjects, Scene } from 'phaser';

const fullCircle = Math.PI * 2;
const normalizeAngle = (angle: number): number => ((angle % fullCircle) + fullCircle) % fullCircle;

/** Camera-local tint with a lit ambient circle and the same cone used by entity visibility. */
export class WorldLighting {
    private readonly overlay: GameObjects.Graphics;
    private readonly scene: Scene;
    private phase: DaylightPhase | null = null;
    private signature = '';

    constructor(scene: Scene) {
        this.scene = scene;
        this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(10);
    }

    setPhase(phase: DaylightPhase | null): void {
        this.phase = phase;
        this.signature = '';
        this.overlay.clear();
        this.scene.game.canvas.dataset['daylightPhase'] = phase ?? 'unknown';
        this.scene.game.canvas.dataset['daylightOpacity'] = String(
            phase === null ? 0 : daylightPhases[phase].opacity,
        );
    }

    draw({
        position,
        angleRadians,
        isFlashlightOn,
    }: {
        readonly position: WorldPosition | null;
        readonly angleRadians: number;
        readonly isFlashlightOn: boolean;
    }): void {
        const camera = this.scene.cameras.main;
        const x = position === null ? 0 : 480 + position.xMeters * 24 - camera.scrollX;
        const y = position === null ? 0 : 270 + position.yMeters * 24 - camera.scrollY;
        const { width, height } = this.scene.scale;
        const signature = [
            this.phase,
            x,
            y,
            width,
            height,
            isFlashlightOn,
            isFlashlightOn ? angleRadians : 0,
        ].join(',');
        this.scene.game.canvas.dataset['flashlightOn'] = String(isFlashlightOn);
        if (signature === this.signature) return;

        this.signature = signature;
        this.overlay.clear();
        if (this.phase === null) return;

        const settings = daylightPhases[this.phase];
        this.overlay.fillStyle(settings.color, settings.opacity);
        const isDark = this.phase === 'night' || this.phase === 'dusk';
        if (position === null || !isDark) {
            this.overlay.fillRect(0, 0, width, height);
            return;
        }

        // Trapezoids cover the dark region outside the circle/cone. No new texture,
        // mask, renderer-specific inversion or per-frame asset allocation is needed.
        const segments = 96;
        const angles = Array.from(
            { length: segments + 1 },
            (_, index) => (index * fullCircle) / segments,
        );
        if (isFlashlightOn)
            angles.push(
                normalizeAngle(angleRadians - flashlightSettings.halfAngleRadians),
                normalizeAngle(angleRadians + flashlightSettings.halfAngleRadians),
            );
        angles.sort((first, second) => first - second);
        const outerRadius = Math.hypot(width, height) * 2;
        for (let index = 0; index < angles.length - 1; index++) {
            const first = angles[index];
            const second = angles[index + 1];
            if (first === undefined || second === undefined || first === second) continue;

            const isInBeam =
                isFlashlightOn &&
                isWithinFlashlightAngle({
                    angleRadians: (first + second) / 2,
                    facingAngleRadians: angleRadians,
                });
            const radiusMeters = isInBeam
                ? Math.max(settings.visibilityMeters, flashlightSettings.rangeMeters)
                : settings.visibilityMeters;
            const innerRadius = (radiusMeters * 24) / Math.cos((second - first) / 2);
            this.overlay
                .beginPath()
                .moveTo(x + Math.cos(first) * innerRadius, y + Math.sin(first) * innerRadius)
                .lineTo(x + Math.cos(first) * outerRadius, y + Math.sin(first) * outerRadius)
                .lineTo(x + Math.cos(second) * outerRadius, y + Math.sin(second) * outerRadius)
                .lineTo(x + Math.cos(second) * innerRadius, y + Math.sin(second) * innerRadius)
                .closePath()
                .fillPath();
        }
    }

    destroy(): void {
        this.overlay.destroy();
        delete this.scene.game.canvas.dataset['daylightPhase'];
        delete this.scene.game.canvas.dataset['daylightOpacity'];
        delete this.scene.game.canvas.dataset['flashlightOn'];
    }
}
