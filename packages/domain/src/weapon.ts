export type MeleeWeaponId = 'club' | 'knife' | 'crowbar' | 'axe';

export type WeaponId = MeleeWeaponId | 'pistol';

export const isWeaponId = (value: unknown): value is WeaponId =>
    value === 'pistol' || isMeleeWeaponId(value);

export const isMeleeWeaponId = (value: unknown): value is MeleeWeaponId =>
    value === 'club' || value === 'knife' || value === 'crowbar' || value === 'axe';
