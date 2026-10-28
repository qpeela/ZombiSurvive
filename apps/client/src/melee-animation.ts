import { meleeWeapons, movementSettings } from '@zombi-survive/content';
import type { MeleeWeaponId } from '@zombi-survive/domain';
import type { MeleeAction } from '@zombi-survive/protocol';

type WeaponPose = {
    readonly rotation: number;
    readonly reach: number;
    readonly phase: 'idle' | 'prepare' | 'strike' | 'return';
};
const idle: WeaponPose = { rotation: 0, reach: 0, phase: 'idle' };

/** Local presentation clock; the server action is the only way to start a swing. */
export class MeleeAnimation {
    private weapon: MeleeWeaponId | null = null;
    private elapsedMs: number | null = null;
    tick = -1;

    setWeapon(weapon: MeleeWeaponId | null): void {
        if (weapon !== this.weapon) {
            this.elapsedMs = null;
        }

        this.weapon = weapon;

        if (weapon === null) {
            this.tick = -1;
        }
    }

    accept(action: MeleeAction): boolean {
        const isNew = action.tick > this.tick;
        const isEquipped = action.weapon === this.weapon;

        if (!isNew || !isEquipped) {
            return false;
        }

        this.tick = action.tick;
        this.elapsedMs = 0;
        return true;
    }

    advance(deltaMs: number): WeaponPose {
        if (this.weapon === null || this.elapsedMs === null) {
            return idle;
        }

        const durationMs =
            (meleeWeapons[this.weapon].cooldownTicks / movementSettings.ticksPerSecond) * 1000;
        this.elapsedMs += Math.max(0, deltaMs);
        const progress = this.elapsedMs / durationMs;

        if (progress >= 1) {
            this.elapsedMs = null;
            return idle;
        }

        const isKnife = this.weapon === 'knife';

        if (progress < 0.2) {
            const amount = progress / 0.2;
            return {
                rotation: isKnife ? 0 : -0.9 * amount,
                reach: isKnife ? -4 * amount : 0,
                phase: 'prepare',
            };
        }

        if (progress < 0.45) {
            const amount = (progress - 0.2) / 0.25;
            return {
                rotation: isKnife ? 0 : -0.9 + 2.3 * amount,
                reach: isKnife ? -4 + 20 * amount : 0,
                phase: 'strike',
            };
        }

        const amount = (1 - progress) / 0.55;
        return {
            rotation: isKnife ? 0 : 1.4 * amount,
            reach: isKnife ? 16 * amount : 0,
            phase: 'return',
        };
    }
}
