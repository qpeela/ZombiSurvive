import type { WorldPosition } from './movement.ts';
import type { MeleeWeaponId } from './weapon.ts';

export type Item = { readonly itemId: string; readonly kind: 'bandage' | MeleeWeaponId };
export type GroundItem = Item & { readonly position: WorldPosition };
