import {
    coldSettings,
    type DaylightPhase,
    fatigueSettings,
    hungerSettings,
    thirstSettings,
    wetnessSettings,
    workshopCanopy,
    type WorldWeather,
} from '@zombi-survive/content';
import type {
    ItemLocation,
    PlayerNeeds,
    StaminaEffects,
    WorldPosition,
} from '@zombi-survive/domain';

export const initialPlayerNeeds: PlayerNeeds = Object.freeze({
    thirstMs: 0,
    hungerMs: 0,
    fatigueMs: 0,
    wetnessMs: 0,
    coldMs: 0,
});

export const advanceNeeds = (needs: PlayerNeeds, elapsedWorldMs: number): PlayerNeeds => ({
    ...needs,
    thirstMs: Math.min(thirstSettings.maximumMs, needs.thirstMs + elapsedWorldMs),
    hungerMs: Math.min(hungerSettings.maximumMs, needs.hungerMs + elapsedWorldMs),
    fatigueMs: Math.min(fatigueSettings.maximumMs, needs.fatigueMs + elapsedWorldMs),
});

export const advanceWetness = ({
    wetnessMs,
    elapsedWorldMs,
    position,
    weather,
}: {
    readonly wetnessMs: number;
    readonly elapsedWorldMs: number;
    readonly position: WorldPosition;
    readonly weather: WorldWeather;
}): number => {
    const { xMeters, yMeters } = position;
    const isInsideCanopyX =
        xMeters >= workshopCanopy.minXMeters && xMeters <= workshopCanopy.maxXMeters;
    const isInsideCanopyY =
        yMeters >= workshopCanopy.minYMeters && yMeters <= workshopCanopy.maxYMeters;
    if (isInsideCanopyX && isInsideCanopyY) return wetnessMs;

    return weather === 'rain'
        ? Math.min(wetnessSettings.maximumMs, wetnessMs + elapsedWorldMs)
        : Math.max(0, wetnessMs - elapsedWorldMs);
};

export const advanceCold = ({
    coldMs,
    wetnessMs,
    elapsedWorldMs,
    phase,
}: {
    readonly coldMs: number;
    readonly wetnessMs: number;
    readonly elapsedWorldMs: number;
    readonly phase: DaylightPhase;
}): number => {
    if (phase === 'day') return Math.max(0, coldMs - elapsedWorldMs);
    if (phase !== 'night') return coldMs;

    const multiplier = wetnessMs > 0 ? coldSettings.wetCoolingMultiplier : 1;
    return Math.min(coldSettings.maximumMs, coldMs + elapsedWorldMs * multiplier);
};

export const staminaEffectsFromNeeds = ({
    hungerMs,
    thirstMs,
    fatigueMs,
}: Pick<PlayerNeeds, 'hungerMs' | 'thirstMs' | 'fatigueMs'>): StaminaEffects => ({
    isRecoverySlowed: hungerMs >= hungerSettings.staminaPenaltyAtMs,
    isDrainIncreased: thirstMs >= thirstSettings.staminaPenaltyAtMs,
    ...(fatigueMs >= fatigueSettings.staminaPenaltyAtMs
        ? { maximumStamina: fatigueSettings.maximumStamina }
        : {}),
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
