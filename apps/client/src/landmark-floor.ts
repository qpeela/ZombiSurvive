import type { worldLandmarks } from '@zombi-survive/content';
import type { GameObjects } from 'phaser';

export const drawLandmarkFloor = ({
    graphics,
    landmark,
    x,
    y,
    width,
    height,
    entranceX,
}: {
    readonly graphics: GameObjects.Graphics;
    readonly landmark: (typeof worldLandmarks)[number];
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly entranceX: number;
}): void => {
    const isWarehouse = landmark.id === 'military-warehouse';
    const concrete = isWarehouse ? 0x575f4c : 0x63605a;
    const paint = isWarehouse ? 0xb1bc87 : 0xba865b;
    graphics
        .fillStyle(concrete)
        .fillRect(x, y, width, height)
        .lineStyle(2, 0x313c31)
        .strokeRect(x, y, width, height)
        .lineBetween(x, y + height / 2, x + width, y + height / 2)
        .lineBetween(x + width / 2, y, x + width / 2, y + height)
        .fillStyle(paint)
        .fillRect(entranceX - 22, y + 2, 44, 4);
    if (isWarehouse) {
        graphics.lineStyle(2, paint);
        for (const column of [0.16, 0.66]) {
            graphics.strokeRect(x + width * column, y + height * 0.3, width * 0.18, height * 0.49);
            graphics.lineBetween(
                x + width * column,
                y + height * 0.54,
                x + width * (column + 0.18),
                y + height * 0.54,
            );
        }

        return;
    }

    graphics
        .fillStyle(0x3a3f39)
        .fillRect(x + width * 0.35, y + height * 0.2, width * 0.38, height * 0.58)
        .lineStyle(3, paint);
    for (const column of [0.36, 0.69]) {
        graphics.lineBetween(
            x + width * column,
            y + height * 0.25,
            x + width * column,
            y + height * 0.74,
        );
    }
};
