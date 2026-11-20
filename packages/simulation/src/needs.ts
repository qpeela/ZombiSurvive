import { hungerSettings, thirstSettings } from '@zombi-survive/content';
import type { ItemLocation, PlayerNeeds } from '@zombi-survive/domain';

export const initialPlayerNeeds: PlayerNeeds = Object.freeze({ thirstMs: 0, hungerMs: 0 });

export const advanceNeeds = (needs: PlayerNeeds, elapsedWorldMs: number): PlayerNeeds => ({
    thirstMs: Math.min(thirstSettings.maximumMs, needs.thirstMs + elapsedWorldMs),
    hungerMs: Math.min(hungerSettings.maximumMs, needs.hungerMs + elapsedWorldMs),
});

type ConsumeSupply = {
    readonly needs: PlayerNeeds;
    readonly locations: readonly ItemLocation[];
    readonly itemId: string;
    readonly playerId: string;
};

type Consumption = { readonly needs: PlayerNeeds; readonly locations: readonly ItemLocation[] };

export const drinkWater = ({ needs, locations, itemId, playerId }: ConsumeSupply): Consumption => {
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
        needs: { ...needs, thirstMs: Math.max(0, needs.thirstMs - thirstSettings.servingReliefMs) },
        locations: locations.map(location =>
            location === bottle
                ? { ...bottle, item: { itemId, kind: 'waterBottle', servings: 0 } }
                : location,
        ),
    };
};

export const eatRation = ({ needs, locations, itemId, playerId }: ConsumeSupply): Consumption => {
    const ration = locations.find(location => {
        const isOwned = location.type === 'container' && location.playerId === playerId;
        const isRation = location.item.kind === 'ration' && location.item.itemId === itemId;
        return isOwned && isRation;
    });
    if (ration === undefined) return { needs, locations };

    return {
        needs: { ...needs, hungerMs: Math.max(0, needs.hungerMs - hungerSettings.rationReliefMs) },
        locations: locations.map(location =>
            location === ration ? { type: 'consumed', item: { itemId, kind: 'ration' } } : location,
        ),
    };
};
