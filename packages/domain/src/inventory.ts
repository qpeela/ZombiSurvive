import type { GroundItem, Item } from './item.ts';
import type { PlayerId } from './movement.ts';

export type InventoryCell = { readonly column: number; readonly row: number };
export type InventoryItem = Item & { readonly cell: InventoryCell };
export type InventorySettings = {
    readonly columns: number;
    readonly rows: number;
    readonly maxWeightGrams: number;
};

export type ItemLocation =
    | { readonly type: 'ground'; readonly item: GroundItem }
    | {
          readonly type: 'container';
          readonly item: Item;
          readonly playerId: PlayerId;
          readonly cell: InventoryCell;
      };
