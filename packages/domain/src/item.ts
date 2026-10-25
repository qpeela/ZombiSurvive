import type { WorldPosition } from './movement.ts';

export type Item = { readonly itemId: string; readonly kind: 'bandage' };
export type GroundItem = Item & { readonly position: WorldPosition };
