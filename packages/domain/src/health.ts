import type { PlayerId } from './movement.ts';

export type PlayerLifeState = 'alive' | 'dead';

/** Health is the durable source of truth; death has no separate mutable flag. */
export const playerLifeState = (health: number): PlayerLifeState => (health > 0 ? 'alive' : 'dead');

export type PlayerHealth = {
    readonly playerId: PlayerId;
    readonly health: number;
};

export type ZombieAttackState = {
    readonly targetPlayerId: PlayerId | null;
    readonly ticksUntilHit: number;
};

export type BleedingState = {
    /** Zero means no wound; positive values are fixed steps until the next HP loss. */
    readonly bleedingTicks: number;
};
