export type MeleeWeaponId = 'club' | 'knife' | 'crowbar' | 'axe';

export const isMeleeWeaponId = (value: unknown): value is MeleeWeaponId =>
    value === 'club' || value === 'knife' || value === 'crowbar' || value === 'axe';
