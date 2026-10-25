import type { PlayerId, WorldPosition } from './movement.ts';

export type ZombieState = {
    readonly zombieId: string;
    readonly position: WorldPosition;
    readonly targetPlayerId: PlayerId | null;
};
