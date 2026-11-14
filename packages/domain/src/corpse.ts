import type { WorldPosition } from './movement.ts';

export type Corpse = {
    readonly corpseId: string;
    readonly playerId: string;
    readonly position: WorldPosition;
    readonly diedAtMs: number;
};
