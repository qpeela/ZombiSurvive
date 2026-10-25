import type { PlayerId, WorldPosition } from './movement.ts';

export type Item = { readonly itemId: string; readonly kind: 'bandage' };
export type GroundItem = Item & { readonly position: WorldPosition };
export type ItemLocation =
    | { readonly type: 'ground'; readonly item: GroundItem }
    | { readonly type: 'container'; readonly item: Item; readonly playerId: PlayerId };
