import type { WorldPosition } from '@zombi-survive/domain';
import type { GameObjects, Scene } from 'phaser';

import {
    CharacterMotion,
    type CharacterPose,
    interpolateCharacterPosition,
} from './character-pose';

const pixelsPerMeter = 24;
type Point = { readonly x: number; readonly y: number };
type CharacterKind = 'player' | 'other' | 'zombie';
type Appearance = {
    readonly cloth: number;
    readonly light: number;
    readonly dark: number;
    readonly skin: number;
    readonly skinShadow: number;
    readonly trousers: number;
};
const appearances: Record<CharacterKind, Appearance> = {
    player: {
        cloth: 0x71845a,
        light: 0x9ba477,
        dark: 0x46533b,
        skin: 0xd2b28d,
        skinShadow: 0x92755d,
        trousers: 0x39433a,
    },
    other: {
        cloth: 0x627f94,
        light: 0x90a8af,
        dark: 0x3a5263,
        skin: 0xc6a582,
        skinShadow: 0x8c6e57,
        trousers: 0x343d44,
    },
    zombie: {
        cloth: 0x79594e,
        light: 0x9a7963,
        dark: 0x4c3e36,
        skin: 0x9aab85,
        skinShadow: 0x66735d,
        trousers: 0x3d4036,
    },
};

/** A persistent articulated figure. World coordinates still refer to the original actor root. */
export class CharacterVisual {
    readonly root: GameObjects.Container;
    private readonly image: GameObjects.Graphics;
    private readonly motion: CharacterMotion;
    private readonly id: string;
    private readonly kind: CharacterKind;
    private target: WorldPosition | null = null;
    private rendered: WorldPosition | null = null;
    private isSneaking = false;
    private isPursuing = false;
    private pose: CharacterPose | null = null;
    private hand: Point | null = null;

    constructor({
        scene,
        id,
        kind,
    }: {
        readonly scene: Scene;
        readonly id: string;
        readonly kind: CharacterKind;
    }) {
        this.id = id;
        this.kind = kind;
        this.motion = new CharacterMotion(id);
        this.image = scene.add.graphics();
        const labels = { player: 'Вы', other: 'Друг', zombie: 'Зомби' };
        const label = scene.add
            .text(0, -36, labels[kind], {
                fontFamily: 'monospace',
                fontSize: '12px',
                color: kind === 'zombie' ? '#e1a48b' : '#d8e3c9',
            })
            .setOrigin(0.5);
        this.root = scene.add.container(480, 270, [this.image, label]).setDepth(1);
    }

    setTarget({
        position,
        isSneaking = false,
        isPursuing = false,
    }: {
        readonly position: WorldPosition;
        readonly isSneaking?: boolean;
        readonly isPursuing?: boolean;
    }): void {
        this.target = { ...position };
        this.isSneaking = isSneaking;
        this.isPursuing = isPursuing;
        if (this.rendered === null || this.kind === 'player') this.place(position);
        this.root.setVisible(true).setScale(1, isSneaking ? 0.75 : 1);
    }

    reset(): void {
        this.target = null;
        this.rendered = null;
        this.pose = null;
        this.hand = null;
        this.motion.reset();
        this.root.setVisible(false);
    }

    destroy(): void {
        this.root.destroy();
    }

    advance({
        deltaMs,
        facingAngle,
        weaponHand,
        reach = 0,
    }: {
        readonly deltaMs: number;
        readonly facingAngle?: number;
        /** Relative to the root in world pixels, before the crouch transform. */
        readonly weaponHand?: Point;
        readonly reach?: number;
    }): void {
        if (this.target === null || this.rendered === null) return;
        if (this.kind !== 'player') {
            this.place(
                interpolateCharacterPosition({
                    current: this.rendered,
                    target: this.target,
                    deltaMs,
                }),
            );
        }
        const position = this.rendered;
        this.pose = this.motion.sample({
            position,
            deltaMs,
            isSneaking: this.isSneaking,
            isZombie: this.kind === 'zombie',
        });
        const angle = facingAngle ?? this.pose.heading;
        this.hand =
            weaponHand === undefined
                ? null
                : { x: weaponHand.x, y: weaponHand.y / this.root.scaleY };
        this.draw({ pose: this.pose, angle, reach });
    }

    snapshot(): object {
        return {
            id: this.id,
            kind: this.kind,
            position: this.rendered,
            mode: this.pose?.mode ?? 'hidden',
            phase: this.pose?.phase ?? 0,
            leftStep: this.pose?.leftStep ?? 0,
            rightStep: this.pose?.rightStep ?? 0,
            hand:
                this.hand === null
                    ? null
                    : {
                          x: this.root.x + this.hand.x,
                          y: this.root.y + this.hand.y * this.root.scaleY,
                      },
        };
    }

    private place(position: WorldPosition): void {
        this.rendered = { ...position };
        this.root.setPosition(
            480 + position.xMeters * pixelsPerMeter,
            270 + position.yMeters * pixelsPerMeter,
        );
    }

    private limb({
        from,
        joint,
        to,
        color,
        width,
    }: {
        readonly from: Point;
        readonly joint: Point;
        readonly to: Point;
        readonly color: number;
        readonly width: number;
    }): void {
        this.image
            .lineStyle(width + 2, 0x1c251e)
            .lineBetween(from.x, from.y, joint.x, joint.y)
            .lineBetween(joint.x, joint.y, to.x, to.y);
        this.image
            .lineStyle(width, color)
            .lineBetween(from.x, from.y, joint.x, joint.y)
            .lineBetween(joint.x, joint.y, to.x, to.y);
    }

    private draw({
        pose,
        angle,
        reach,
    }: {
        readonly pose: CharacterPose;
        readonly angle: number;
        readonly reach: number;
    }): void {
        const image = this.image;
        const appearance = appearances[this.kind];
        const isZombie = this.kind === 'zombie';
        const leanX = Math.cos(angle) * reach * 0.5;
        const leanY = Math.sin(angle) * reach * 0.5;
        const bodyY = -pose.bob + pose.breath + leanY;
        const profile = 0.72 + Math.abs(Math.sin(angle)) * 0.28;
        const shoulder = 6.5 * profile;
        const hunch = isZombie ? 2 : 0;
        image.clear().fillStyle(0x0b100e, 0.5).fillEllipse(0, 19, 23, 8);

        for (const side of [-1, 1]) {
            const step = side < 0 ? pose.leftStep : pose.rightStep;
            const lift = side < 0 ? pose.leftLift : pose.rightLift;
            const foot = {
                x: side * 3.5 + Math.cos(pose.heading) * step,
                y: 17 + Math.sin(pose.heading) * step * 0.5 - lift,
            };
            this.limb({
                from: { x: side * 3, y: 1 },
                joint: { x: side * 3.5, y: 9 + step * 0.35 },
                to: foot,
                color: appearance.trousers,
                width: 4,
            });
            image.fillStyle(0x202820).fillRoundedRect(foot.x - 2.5, foot.y - 1, 5, 4, 1);
            image.fillStyle(0x626752).fillRect(foot.x - 2, foot.y - 1, 4, 1);
        }

        const leftShoulder = { x: leanX - shoulder, y: bodyY - 11 + hunch };
        const rightShoulder = { x: leanX + shoulder, y: bodyY - 11 };
        const grasp = this.isPursuing ? 5 : 1;
        const leftHand = {
            x: leanX - 8 - pose.leftStep * 0.5,
            y: bodyY + 1 - hunch - (isZombie ? grasp : 0),
        };
        const rightHand = this.hand ?? {
            x: leanX + 8 + pose.leftStep * 0.5,
            y: bodyY + 1 - (isZombie ? grasp + 2 : 0),
        };
        this.limb({
            from: leftShoulder,
            joint: { x: leanX - 9, y: bodyY - 5 },
            to: leftHand,
            color: appearance.dark,
            width: 4,
        });

        image
            .fillStyle(0x1c251e)
            .fillRoundedRect(leanX - shoulder - 1, bodyY - 14, shoulder * 2 + 2, 18, 3);
        image
            .fillStyle(appearance.cloth)
            .fillRoundedRect(leanX - shoulder, bodyY - 13, shoulder * 2, 16, 2);
        image.fillStyle(appearance.dark).fillRect(leanX - shoulder, bodyY - 10, 3, 12);
        image
            .fillStyle(appearance.light)
            .fillRect(leanX - shoulder + 3, bodyY - 12, shoulder * 2 - 5, 2);
        image.fillStyle(0x303b2d).fillRect(leanX - 5, bodyY + 1, 10, 3);
        image.fillStyle(0xaca181).fillRect(leanX - 1, bodyY + 1, 2, 2);
        image.lineStyle(1, appearance.dark).lineBetween(leanX, bodyY - 10, leanX, bodyY);
        image.fillStyle(appearance.dark).fillRect(leanX + 2, bodyY - 8, 3, 3);
        if (isZombie) {
            image
                .fillStyle(0x414839)
                .fillTriangle(leanX - 5, bodyY - 5, leanX - 1, bodyY - 2, leanX - 4, bodyY + 2);
            image.lineStyle(1, 0xaba18a).lineBetween(leanX + 3, bodyY - 6, leanX + 5, bodyY - 3);
        }

        this.limb({
            from: rightShoulder,
            joint: {
                x: (rightShoulder.x + rightHand.x) / 2 + 2,
                y: (rightShoulder.y + rightHand.y) / 2,
            },
            to: rightHand,
            color: appearance.cloth,
            width: 4,
        });
        for (const hand of [leftHand, rightHand]) {
            image.fillStyle(appearance.skinShadow).fillCircle(hand.x, hand.y, 2.7);
            image.fillStyle(appearance.skin).fillRect(hand.x - 1.5, hand.y - 2, 3, 3);
        }

        const headX = leanX + Math.cos(angle) * 1.2 + (isZombie ? -1 : 0);
        const headY = bodyY - 19 + hunch;
        image.fillStyle(appearance.skinShadow).fillRect(headX - 2, headY + 4, 4, 3);
        image.fillStyle(0x1c251e).fillEllipse(headX, headY, 9, 11);
        image.fillStyle(appearance.skinShadow).fillEllipse(headX, headY, 7, 9);
        image.fillStyle(appearance.skin).fillEllipse(headX + 0.8, headY - 0.5, 5.5, 8);
        const isBack = Math.sin(angle) < -0.35;
        image
            .fillStyle(isZombie ? 0x515d46 : 0x493e30)
            .fillEllipse(headX - 0.5, headY - 3, 7, isBack ? 7 : 4);
        if (!isBack) {
            const noseX = headX + Math.cos(angle) * 2;
            image
                .fillStyle(0x343c2c)
                .fillRect(headX - 2, headY, 1, 1)
                .fillRect(headX + 1, headY, 1, 1);
            image.fillStyle(appearance.skinShadow).fillRect(noseX, headY + 1, 1.5, 2);
        }
    }
}
