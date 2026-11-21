import { fatigueSettings, hungerSettings, thirstSettings } from '@zombi-survive/content';
import type { PlayerNeeds } from '@zombi-survive/domain';

export type SavedWorldProgress = {
    readonly worldTimeMs: number;
    readonly needs?: PlayerNeeds;
    readonly restocks?: ReadonlyMap<string, number>;
};

export const readSavedWorldTime = (value: unknown): number => {
    const isValidTime = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (!isValidTime) throw new Error('Solo save contains invalid world time.');

    return value;
};

export const readSavedNeeds = (value: unknown): PlayerNeeds => {
    if (typeof value !== 'string') throw new Error('Solo save contains invalid player needs.');
    const needs: unknown = JSON.parse(value);
    if (typeof needs !== 'object' || needs === null || !('thirstMs' in needs))
        throw new Error('Solo save contains invalid player needs.');

    const thirstMs = needs.thirstMs;
    if (
        typeof thirstMs !== 'number' ||
        !Number.isSafeInteger(thirstMs) ||
        thirstMs < 0 ||
        thirstMs > thirstSettings.maximumMs
    )
        throw new Error('Solo save contains invalid player thirst.');

    const hungerMs = 'hungerMs' in needs ? needs.hungerMs : 0;
    if (
        typeof hungerMs !== 'number' ||
        !Number.isSafeInteger(hungerMs) ||
        hungerMs < 0 ||
        hungerMs > hungerSettings.maximumMs
    )
        throw new Error('Solo save contains invalid player hunger.');

    const fatigueMs = 'fatigueMs' in needs ? needs.fatigueMs : 0;
    if (
        typeof fatigueMs !== 'number' ||
        !Number.isSafeInteger(fatigueMs) ||
        fatigueMs < 0 ||
        fatigueMs > fatigueSettings.maximumMs
    )
        throw new Error('Solo save contains invalid player fatigue.');

    return { thirstMs, hungerMs, fatigueMs };
};

export const writeSavedNeeds = (needs: PlayerNeeds): string =>
    JSON.stringify(readSavedNeeds(JSON.stringify(needs)));
