import { thirstSettings } from '@zombi-survive/content';
import type { ItemLocation, PlayerNeeds } from '@zombi-survive/domain';

export const initialPlayerNeeds: PlayerNeeds = Object.freeze({ thirstMs: 0 });

export const advanceNeeds = (needs: PlayerNeeds, elapsedWorldMs: number): PlayerNeeds => ({
    thirstMs: Math.min(thirstSettings.maximumMs, needs.thirstMs + elapsedWorldMs),
});

export const drinkWater = ({
    needs,
    locations,
    itemId,
    playerId,
}: {
    readonly needs: PlayerNeeds;
    readonly locations: readonly ItemLocation[];
    readonly itemId: string;
    readonly playerId: string;
}): { readonly needs: PlayerNeeds; readonly locations: readonly ItemLocation[] } => {
    const bottle = locations.find(location => {
        const isOwned = location.type === 'container' && location.playerId === playerId;
        const isFullBottle =
            location.item.kind === 'waterBottle' &&
            location.item.servings === 1 &&
            location.item.itemId === itemId;
        return isOwned && isFullBottle;
    });
    if (bottle === undefined || bottle.type !== 'container') return { needs, locations };

    return {
        needs: { thirstMs: Math.max(0, needs.thirstMs - thirstSettings.servingReliefMs) },
        locations: locations.map(location =>
            location === bottle
                ? { ...bottle, item: { itemId, kind: 'waterBottle', servings: 0 } }
                : location,
        ),
    };
};
