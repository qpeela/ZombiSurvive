import { type DaylightPhase, daylightPhases, flashlightSettings } from '@zombi-survive/content';
import type { WorldObstacle, WorldPosition } from '@zombi-survive/domain';
import { isWithinFlashlightAngle, obstacleRayDistance } from '@zombi-survive/simulation';
import type { GameObjects, Scene } from 'phaser';

const fullCircle = Math.PI * 2;
const normalizeAngle = (angle: number): number => ((angle % fullCircle) + fullCircle) % fullCircle;

/** Camera-local tint with a lit ambient circle and the same cone used by entity visibility. */
export class WorldLighting {
    private readonly overlay: GameObjects.Graphics;
    private readonly scene: Scene;
    private phase: DaylightPhase | null = null;
    private signature = '';
    private obstacles: readonly WorldObstacle[] = [];

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
        obstacles,
    }: {
        readonly position: WorldPosition | null;
        readonly angleRadians: number;
        readonly isFlashlightOn: boolean;
        readonly obstacles: readonly WorldObstacle[];
    }): void {
        const camera = this.scene.cameras.main;
        const x = position === null ? 0 : 480 + position.xMeters * 24 - camera.scrollX;
        const y = position === null ? 0 : 270 + position.yMeters * 24 - camera.scrollY;
        const { width, height } = this.scene.scale;
        const signature = [
            this.phase,
            position?.xMeters,
            position?.yMeters,
            x,
            y,
            width,
            height,
            isFlashlightOn,
            isFlashlightOn ? angleRadians : 0,
        ].join(',');
        this.scene.game.canvas.dataset['flashlightOn'] = String(isFlashlightOn);
        if (signature === this.signature && obstacles === this.obstacles) return;

        this.obstacles = obstacles;

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
        const nearbyWalls = obstacles.filter(wall => {
            const isNearX =
                wall.minXMeters <= position.xMeters + flashlightSettings.rangeMeters &&
                wall.maxXMeters >= position.xMeters - flashlightSettings.rangeMeters;
            const isNearY =
                wall.minYMeters <= position.yMeters + flashlightSettings.rangeMeters &&
                wall.maxYMeters >= position.yMeters - flashlightSettings.rangeMeters;

            return isNearX && isNearY;
        });
        // Sample both sides of every corner to preserve sharp shadows and narrow openings.
        for (const wall of nearbyWalls) {
            for (const cornerX of [wall.minXMeters, wall.maxXMeters]) {
                for (const cornerY of [wall.minYMeters, wall.maxYMeters]) {
                    const angle = Math.atan2(
                        cornerY - position.yMeters,
                        cornerX - position.xMeters,
                    );
                    for (const offset of [-1e-7, 0, 1e-7])
                        angles.push(normalizeAngle(angle + offset));
                }
            }
        }
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
            const rayRadius = (angle: number): number => {
                const direction = { x: Math.cos(angle), y: Math.sin(angle) };
                let distance = radiusMeters;
                for (const wall of nearbyWalls) {
                    const hit = obstacleRayDistance({
                        origin: position,
                        direction,
                        wall,
                        rangeMeters: radiusMeters,
                    });
                    if (hit !== null) distance = Math.min(distance, hit);
                }

                return distance * 24;
            };
            const firstRadius = rayRadius(first);
            const secondRadius = rayRadius(second);
            this.overlay
                .beginPath()
                .moveTo(x + Math.cos(first) * firstRadius, y + Math.sin(first) * firstRadius)
                .lineTo(x + Math.cos(first) * outerRadius, y + Math.sin(first) * outerRadius)
                .lineTo(x + Math.cos(second) * outerRadius, y + Math.sin(second) * outerRadius)
                .lineTo(x + Math.cos(second) * secondRadius, y + Math.sin(second) * secondRadius)
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
