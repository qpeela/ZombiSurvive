import type { MeleeWeaponId } from '@zombi-survive/domain';
import type { GameObjects } from 'phaser';

/** Original procedural pixel silhouettes, pointing right with the grip at (10, 6). */
export const drawHeldWeapon = (image: GameObjects.Graphics, weapon: MeleeWeaponId | null): void => {
    image.clear();

    switch (weapon) {
        case 'club':
            image.fillStyle(0x30271d).fillRect(9, 3, 27, 7);
            image.fillStyle(0xa57b4d).fillRect(10, 4, 24, 5);
            image.fillStyle(0xd2ac72).fillRect(21, 4, 13, 2);
            break;
        case 'knife':
            image.fillStyle(0x30271d).fillRect(9, 3, 9, 6);
            image.fillStyle(0x8d5f3d).fillRect(10, 4, 7, 4);
            image.fillStyle(0xced7d3).fillTriangle(18, 3, 30, 6, 18, 8);
            image.fillStyle(0x879e9d).fillRect(16, 2, 2, 8);
            break;
        case 'crowbar':
            image.lineStyle(5, 0x252e30).lineBetween(10, 6, 36, 6).lineBetween(36, 6, 39, 0);
            image.lineStyle(3, 0x9faaa8).lineBetween(10, 6, 36, 6).lineBetween(36, 6, 39, 0);
            image.lineBetween(39, 0, 35, -2);
            image.fillStyle(0x674f40).fillRect(10, 4, 9, 4);
            break;
        case 'axe':
            image.fillStyle(0x30271d).fillRect(9, 3, 26, 6);
            image.fillStyle(0xa57b4d).fillRect(10, 4, 24, 4);
            image.fillStyle(0x293334).fillRect(28, -5, 9, 16);
            image.fillStyle(0xaebdb7).fillRect(29, -4, 7, 14);
            image.fillStyle(0xe0e5d8).fillRect(34, -4, 2, 14);
            break;
        case null:
            break;
    }
};
