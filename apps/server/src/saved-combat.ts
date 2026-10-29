import { combatSettings, meleeWeapons } from '@zombi-survive/content';

export type SavedCombat = {
    readonly health: number;
    readonly cooldownTicks: number;
};

const maxCooldownTicks = Math.max(
    ...Object.values(meleeWeapons).map(weapon => weapon.cooldownTicks),
);

export const readSavedCombat = (value: unknown): SavedCombat => {
    if (typeof value !== 'string') throw new Error('Solo save contains invalid combat state.');

    const state: unknown = JSON.parse(value);
    if (typeof state !== 'object' || state === null)
        throw new Error('Solo save contains invalid combat state.');

    const health = 'health' in state ? state.health : undefined;
    const cooldownTicks = 'cooldownTicks' in state ? state.cooldownTicks : undefined;
    const isHealth =
        typeof health === 'number' &&
        Number.isInteger(health) &&
        health >= 0 &&
        health <= combatSettings.maxHealth;
    const isCooldown =
        typeof cooldownTicks === 'number' &&
        Number.isInteger(cooldownTicks) &&
        cooldownTicks >= 0 &&
        cooldownTicks <= maxCooldownTicks;

    if (!isHealth || !isCooldown) throw new Error('Solo save contains invalid combat state.');

    return { health, cooldownTicks };
};
