import { combatSettings } from '@zombi-survive/content';
import type { BleedingState, PlayerHealth } from '@zombi-survive/domain';

type WoundedPlayer = PlayerHealth & BleedingState;

/** Called once per fixed world step, before new zombie wounds. Zero HP freezes the wound. */
export const stepBleeding = (state: WoundedPlayer): WoundedPlayer => {
    if (state.health <= 0 || state.bleedingTicks === 0) {
        return state;
    }

    if (state.bleedingTicks > 1) {
        return { ...state, bleedingTicks: state.bleedingTicks - 1 };
    }

    return {
        ...state,
        health: Math.max(0, state.health - combatSettings.bleedingDamage),
        bleedingTicks: combatSettings.bleedingIntervalTicks,
    };
};

/** Only a confirmed damaging zombie hit may call this; the server supplies a roll in [0, 1). */
export const woundFromZombieHit = (state: WoundedPlayer, roll: number): WoundedPlayer => {
    if (state.health <= 0 || state.bleedingTicks > 0 || roll >= combatSettings.bleedingChance) {
        return state;
    }

    return { ...state, bleedingTicks: combatSettings.bleedingIntervalTicks };
};
