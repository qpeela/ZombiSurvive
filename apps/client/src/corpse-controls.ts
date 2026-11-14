import { itemDefinitions, pickupSettings } from '@zombi-survive/content';
import type { Corpse, InventoryItem, Item, WorldPosition } from '@zombi-survive/domain';
import { findInventorySpace } from '@zombi-survive/simulation';

type CorpseLoot = Corpse & { readonly items: readonly Item[] };

export const createCorpseControls = (
    element: HTMLElement,
    pickUp: (itemId: string) => void,
): {
    update: (input: {
        readonly corpses: readonly CorpseLoot[];
        readonly position: WorldPosition | null;
        readonly items: readonly InventoryItem[];
        readonly isAlive: boolean;
    }) => void;
    dispose: () => void;
} => {
    const buttons = new Map<string, HTMLButtonElement>();
    const onClick = (event: Event): void => {
        const target = event.target;
        if (target instanceof HTMLButtonElement && !target.disabled) {
            const itemId = target.dataset['itemId'];
            if (itemId !== undefined) pickUp(itemId);
        }
    };
    element.addEventListener('click', onClick);
    return {
        update: ({ corpses, position, items, isAlive }) => {
            const ids = new Set(corpses.flatMap(corpse => corpse.items.map(item => item.itemId)));
            for (const [id, button] of buttons) {
                if (!ids.has(id)) {
                    button.remove();
                    buttons.delete(id);
                }
            }
            for (const corpse of corpses) {
                const distance =
                    position === null
                        ? Infinity
                        : Math.hypot(
                              position.xMeters - corpse.position.xMeters,
                              position.yMeters - corpse.position.yMeters,
                          );
                for (const item of corpse.items) {
                    let button = buttons.get(item.itemId);
                    if (button === undefined) {
                        button = document.createElement('button');
                        button.type = 'button';
                        button.dataset['itemId'] = item.itemId;
                        buttons.set(item.itemId, button);
                        element.append(button);
                    }
                    button.textContent = `Забрать с тела: ${itemDefinitions[item.kind].name} · ${String(corpse.position.xMeters)}, ${String(corpse.position.yMeters)} м`;
                    const hasSpace = findInventorySpace({ items, item }) !== null;
                    button.disabled =
                        !isAlive || distance > pickupSettings.rangeMeters || !hasSpace;
                    button.title = 'Подойдите к телу на 1,5 м без стены; нужно место в инвентаре.';
                }
            }
        },
        dispose: () => {
            element.removeEventListener('click', onClick);
        },
    };
};
