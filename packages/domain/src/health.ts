import type { PlayerId } from './movement.ts';

export type PlayerHealth = {
    readonly playerId: PlayerId;
    readonly health: number;
};

export type ZombieAttackState = {
    readonly targetPlayerId: PlayerId | null;
    readonly ticksUntilHit: number;
};
