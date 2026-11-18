import { medicalOutpost } from '@zombi-survive/content';
import type { WorldChunk, WorldObstacle, WorldPosition } from '@zombi-survive/domain';
import { loadWorldChunks } from '@zombi-survive/worldgen';
import type { GameObjects, Scene } from 'phaser';

const pixelsPerMeter = 24;
const chunkId = (chunk: WorldChunk): string => `${String(chunk.chunkX)},${String(chunk.chunkY)}`;
const chunkMetadata = (chunk: WorldChunk) => ({
    seed: chunk.seed,
    generatorVersion: chunk.generatorVersion,
    chunkX: chunk.chunkX,
    chunkY: chunk.chunkY,
    terrainTileCount: chunk.terrain.length,
});

/** Owns only the local visible neighbourhood and its Phaser resources. */
export class WorldTerrain {
    obstacles: readonly WorldObstacle[] = [];
    private chunks: readonly WorldChunk[] = [];
    private readonly labels = new Map<string, GameObjects.Text>();
    private readonly graphics = new Map<string, GameObjects.Graphics>();
    private readonly scene: Scene;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    update(position: WorldPosition | null): void {
        const chunks = loadWorldChunks({
            positions: position === null ? [] : [position],
            previousChunks: this.chunks,
        });

        if (chunks === this.chunks) {
            this.updateVisibility(position);
            return;
        }

        const retained = new Set(chunks.map(chunkId));

        for (const [id, graphics] of this.graphics) {
            if (!retained.has(id)) {
                graphics.destroy();
                this.graphics.delete(id);
                this.labels.get(id)?.destroy();
                this.labels.delete(id);
            }
        }

        for (const chunk of chunks) {
            const id = chunkId(chunk);

            if (!this.graphics.has(id)) {
                this.graphics.set(id, this.drawChunk(chunk));
            }
        }

        this.chunks = chunks;
        this.obstacles = chunks.flatMap(chunk => chunk.obstacles);
        const canvas = this.scene.game.canvas;
        canvas.dataset['worldChunks'] = JSON.stringify(chunks.map(chunkMetadata));
        canvas.dataset['obstacles'] = JSON.stringify(this.obstacles);
        const center = chunks.find(chunk => {
            if (position === null) {
                return false;
            }

            const isInsideX =
                position.xMeters >= chunk.minXMeters &&
                position.xMeters < chunk.minXMeters + chunk.sizeMeters;
            const isInsideY =
                position.yMeters >= chunk.minYMeters &&
                position.yMeters < chunk.minYMeters + chunk.sizeMeters;

            return isInsideX && isInsideY;
        });

        if (center === undefined) {
            delete canvas.dataset['worldChunk'];
        } else {
            canvas.dataset['worldChunk'] = JSON.stringify(chunkMetadata(center));
        }

        this.updateVisibility(position);
    }

    contains(position: WorldPosition): boolean {
        return this.chunks.some(chunk => {
            const isInsideX =
                position.xMeters >= chunk.minXMeters &&
                position.xMeters < chunk.minXMeters + chunk.sizeMeters;
            const isInsideY =
                position.yMeters >= chunk.minYMeters &&
                position.yMeters < chunk.minYMeters + chunk.sizeMeters;
            return isInsideX && isInsideY;
        });
    }

    destroy(): void {
        this.update(null);
    }

    private updateVisibility(position: WorldPosition | null): void {
        if (position === null) {
            // Phaser may have shut down CameraManager before the scene's cleanup callback.
            this.scene.game.canvas.dataset['visibleWorldChunkCount'] = '0';

            return;
        }

        const camera = this.scene.cameras.main;
        const halfWidthMeters = camera.width / (2 * pixelsPerMeter * camera.zoom);
        const halfHeightMeters = camera.height / (2 * pixelsPerMeter * camera.zoom);

        for (const chunk of this.chunks) {
            const isInsideX =
                chunk.minXMeters <= position.xMeters + halfWidthMeters &&
                chunk.minXMeters + chunk.sizeMeters >= position.xMeters - halfWidthMeters;
            const isInsideY =
                chunk.minYMeters <= position.yMeters + halfHeightMeters &&
                chunk.minYMeters + chunk.sizeMeters >= position.yMeters - halfHeightMeters;
            const isInView = isInsideX && isInsideY;
            // Graphics replays its command buffer every frame, even outside the viewport.
            this.graphics.get(chunkId(chunk))?.setVisible(isInView);
            this.labels.get(chunkId(chunk))?.setVisible(isInView);
        }

        this.scene.game.canvas.dataset['visibleWorldChunkCount'] = String(
            [...this.graphics.values()].filter(graphics => graphics.visible).length,
        );
    }

    private drawChunk(chunk: WorldChunk): GameObjects.Graphics {
        const graphics = this.scene.add.graphics().setDepth(-1);
        const terrainColors = { grass: 0x23372a, dirt: 0x3d392b, gravel: 0x38413b };
        const tilePixels = chunk.tileSizeMeters * pixelsPerMeter;

        for (const tile of chunk.terrain) {
            const x = 480 + tile.xMeters * pixelsPerMeter;
            const y = 270 + tile.yMeters * pixelsPerMeter;
            graphics.fillStyle(terrainColors[tile.kind]).fillRect(x, y, tilePixels, tilePixels);
            graphics.fillStyle(0x718065, 0.25).fillRect(x + 8, y + 12, 3, 3);
            graphics.fillStyle(0x101c15, 0.3).fillRect(x + 30, y + 32, 6, 2);
        }

        graphics
            .lineStyle(2, 0x7a8962, 0.6)
            .strokeRect(
                480 + chunk.minXMeters * pixelsPerMeter,
                270 + chunk.minYMeters * pixelsPerMeter,
                chunk.sizeMeters * pixelsPerMeter,
                chunk.sizeMeters * pixelsPerMeter,
            );

        const isOutpost =
            chunk.chunkX === medicalOutpost.chunkX && chunk.chunkY === medicalOutpost.chunkY;
        if (isOutpost) {
            const { floor, entrance } = medicalOutpost;
            const x = 480 + floor.minXMeters * pixelsPerMeter;
            const y = 270 + floor.minYMeters * pixelsPerMeter;
            // A tiled floor, broken roof and medical cross distinguish these existing ruins.
            graphics
                .fillStyle(0x77776a)
                .fillRect(
                    x,
                    y,
                    floor.widthMeters * pixelsPerMeter,
                    floor.heightMeters * pixelsPerMeter,
                );
            graphics.lineStyle(1, 0x454c42, 0.8);
            for (let index = 0; index <= 8; index++) {
                graphics.lineBetween(
                    x + index * pixelsPerMeter,
                    y,
                    x + index * pixelsPerMeter,
                    y + 8.5 * pixelsPerMeter,
                );
                graphics.lineBetween(
                    x,
                    y + index * pixelsPerMeter,
                    x + 8.5 * pixelsPerMeter,
                    y + index * pixelsPerMeter,
                );
            }
            graphics.fillStyle(0x465147).fillTriangle(x, y, x + 90, y, x, y + 45);
            graphics.fillStyle(0xd5d0ae).fillRect(x + 105, y + 20, 58, 48);
            graphics
                .fillStyle(0x943e36)
                .fillRect(x + 128, y + 26, 12, 36)
                .fillRect(x + 116, y + 38, 36, 12);
            const entranceX = 480 + entrance.xMeters * pixelsPerMeter;
            const entranceY = 270 + entrance.yMeters * pixelsPerMeter;
            graphics
                .lineStyle(3, 0xdfc584)
                .lineBetween(entranceX, entranceY, entranceX, entranceY - 20);
            graphics.lineBetween(entranceX, entranceY - 20, entranceX - 7, entranceY - 13);
            graphics.lineBetween(entranceX, entranceY - 20, entranceX + 7, entranceY - 13);
            this.labels.set(
                chunkId(chunk),
                this.scene.add
                    .text(x + 100, y - 18, 'Заброшенный медпункт', {
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        color: '#e8dcb8',
                        backgroundColor: '#202b25',
                    })
                    .setOrigin(0.5)
                    .setDepth(-1),
            );
        }

        for (const obstacle of chunk.obstacles) {
            const x = 480 + obstacle.minXMeters * pixelsPerMeter;
            const y = 270 + obstacle.minYMeters * pixelsPerMeter;
            const width = (obstacle.maxXMeters - obstacle.minXMeters) * pixelsPerMeter;
            const height = (obstacle.maxYMeters - obstacle.minYMeters) * pixelsPerMeter;
            graphics
                .fillStyle(0x465147)
                .fillRect(x, y, width, height)
                .lineStyle(2, 0x879779)
                .strokeRect(x, y, width, height)
                .lineStyle(2, 0x253529)
                .lineBetween(x + 3, y + height - 3, x + width - 3, y + height - 3);
        }

        return graphics;
    }
}
