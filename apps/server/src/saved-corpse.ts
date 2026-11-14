import { corpseSettings } from '@zombi-survive/content';
import type { Corpse, ItemLocation } from '@zombi-survive/domain';

export const readSavedCorpses = (
    value: unknown,
    locations: readonly ItemLocation[],
): readonly Corpse[] => {
    const invalid = (): never => {
        throw new Error('Solo save contains invalid corpses.');
    };
    if (typeof value !== 'string' || value.length > 1_048_576) return invalid();
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return invalid();
    const corpses: Corpse[] = [];
    const ids = new Set<string>();
    for (const entry of parsed as unknown[]) {
        if (typeof entry !== 'object' || entry === null) return invalid();
        const { corpseId, playerId, diedAtMs, position } = entry as Record<string, unknown>;
        if (
            typeof corpseId !== 'string' ||
            corpseId.length === 0 ||
            corpseId.length > 128 ||
            ids.has(corpseId)
        )
            return invalid();
        if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > 128)
            return invalid();
        if (typeof diedAtMs !== 'number' || !Number.isSafeInteger(diedAtMs) || diedAtMs < 0)
            return invalid();
        const expiresAtMs = diedAtMs + corpseSettings.lifetimeMs;
        const storedExpiry = 'expiresAtMs' in entry ? entry.expiresAtMs : undefined;
        if (
            !Number.isSafeInteger(expiresAtMs) ||
            (storedExpiry !== undefined && storedExpiry !== expiresAtMs)
        )
            return invalid();
        if (typeof position !== 'object' || position === null) return invalid();
        const { xMeters, yMeters } = position as Record<string, unknown>;
        if (
            typeof xMeters !== 'number' ||
            !Number.isFinite(xMeters) ||
            typeof yMeters !== 'number' ||
            !Number.isFinite(yMeters)
        )
            return invalid();
        ids.add(corpseId);
        corpses.push({ corpseId, playerId, diedAtMs, expiresAtMs, position: { xMeters, yMeters } });
    }
    if (locations.some(location => location.type === 'corpse' && !ids.has(location.corpseId)))
        return invalid();
    return corpses;
};
