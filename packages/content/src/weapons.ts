import type { MeleeWeaponId } from '@zombi-survive/domain';

type MeleeWeapon = {
    readonly id: MeleeWeaponId;
    readonly name: string;
    readonly equipLabel: string;
    readonly damage: number;
    readonly rangeMeters: number;
    readonly cooldownTicks: number;
};

export const meleeWeapons = Object.freeze({
    club: Object.freeze({
        id: 'club',
        name: 'дубинка',
        equipLabel: 'Экипировать дубинку',
        damage: 34,
        rangeMeters: 1.8,
        cooldownTicks: 12,
    }),
    knife: Object.freeze({
        id: 'knife',
        name: 'нож',
        equipLabel: 'Экипировать нож',
        damage: 20,
        rangeMeters: 1.2,
        cooldownTicks: 6,
    }),
    crowbar: Object.freeze({
        id: 'crowbar',
        name: 'лом',
        equipLabel: 'Экипировать лом',
        damage: 40,
        rangeMeters: 2.2,
        cooldownTicks: 16,
    }),
    axe: Object.freeze({
        id: 'axe',
        name: 'топор',
        equipLabel: 'Экипировать топор',
        damage: 60,
        rangeMeters: 1.6,
        cooldownTicks: 24,
    }),
} satisfies Record<MeleeWeaponId, MeleeWeapon>);
