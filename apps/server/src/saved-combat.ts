import { combatSettings, meleeWeapons } from '@zombi-survive/content';

export type SavedCombat = {
    readonly health: number;
    readonly lifeRevision?: number;
    readonly cooldownTicks: number;
    readonly bleedingTicks: number;
    readonly logoutVulnerabilityTicks?: number;
};

const maxCooldownTicks = Math.max(
    ...Object.values(meleeWeapons).map(weapon => weapon.cooldownTicks),
);

export const readSavedCombat = (value: unknown, isLegacy = false): SavedCombat => {
    if (typeof value !== 'string') throw new Error('Solo save contains invalid combat state.');

    const state: unknown = JSON.parse(value);
    if (typeof state !== 'object' || state === null)
        throw new Error('Solo save contains invalid combat state.');

    const health = 'health' in state ? state.health : undefined;
    const savedBleedingTicks = 'bleedingTicks' in state ? state.bleedingTicks : undefined;
    const bleedingTicks = isLegacy ? 0 : savedBleedingTicks;
    const isBleeding =
        typeof bleedingTicks === 'number' &&
        Number.isInteger(bleedingTicks) &&
        bleedingTicks >= 0 &&
        bleedingTicks <= combatSettings.bleedingIntervalTicks;
    const cooldownTicks = 'cooldownTicks' in state ? state.cooldownTicks : undefined;
    const savedLogoutTicks =
        'logoutVulnerabilityTicks' in state ? state.logoutVulnerabilityTicks : undefined;
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

    if (!isHealth || !isCooldown || !isBleeding)
        throw new Error('Solo save contains invalid combat state.');

    if (
        savedLogoutTicks !== undefined &&
        (typeof savedLogoutTicks !== 'number' ||
            !Number.isInteger(savedLogoutTicks) ||
            savedLogoutTicks < 0 ||
            savedLogoutTicks > combatSettings.logoutVulnerabilityTicks ||
            (health === 0 && savedLogoutTicks > 0))
    )
        throw new Error('Solo save contains invalid logout vulnerability.');

    const logoutVulnerabilityTicks =
        typeof savedLogoutTicks === 'number' && savedLogoutTicks > 0
            ? { logoutVulnerabilityTicks: savedLogoutTicks }
            : {};

    const lifeRevision = 'lifeRevision' in state ? state.lifeRevision : undefined;
    if (lifeRevision === undefined)
        return { health, cooldownTicks, bleedingTicks, ...logoutVulnerabilityTicks };
    if (typeof lifeRevision !== 'number' || !Number.isSafeInteger(lifeRevision) || lifeRevision < 0)
        throw new Error('Solo save contains invalid life revision.');
    return { health, cooldownTicks, bleedingTicks, lifeRevision, ...logoutVulnerabilityTicks };
};
