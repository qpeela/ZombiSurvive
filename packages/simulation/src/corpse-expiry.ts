import type { Corpse, ItemLocation } from '@zombi-survive/domain';

/** Removed finite loot keeps an ID tombstone, so loading never regenerates it. */
export const expireCorpses = ({
    corpses,
    locations,
    nowMs,
}: {
    readonly corpses: readonly Corpse[];
    readonly locations: readonly ItemLocation[];
    readonly nowMs: number;
}): { readonly corpses: readonly Corpse[]; readonly locations: readonly ItemLocation[] } | null => {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Invalid corpse clock.');
    const expired = new Set(
        corpses.filter(corpse => corpse.expiresAtMs <= nowMs).map(corpse => corpse.corpseId),
    );
    if (expired.size === 0) return null;
    return {
        corpses: corpses.filter(corpse => !expired.has(corpse.corpseId)),
        locations: locations.map(location =>
            location.type === 'corpse' && expired.has(location.corpseId)
                ? { type: 'expired', item: { ...location.item } }
                : location,
        ),
    };
};
