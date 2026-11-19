import {
    itemDefinitions,
    itemDisplayName,
    itemWeightGrams,
    pickupSettings,
} from '@zombi-survive/content';
import type {
    Corpse,
    GroundItem,
    InventoryItem,
    Item,
    PlayerLifeState,
    WorldPosition,
} from '@zombi-survive/domain';
import { findInventorySpace } from '@zombi-survive/simulation';

export type CorpseLoot = Corpse & { readonly items: readonly Item[] };

type LootRow = {
    readonly element: HTMLElement;
    readonly name: HTMLElement;
    readonly button: HTMLButtonElement;
    readonly reason: HTMLElement;
};

type CorpseGroup = {
    readonly element: HTMLElement;
    readonly empty: HTMLElement;
    readonly rows: Map<string, LootRow>;
};

type NearbyState = {
    readonly ground: GroundItem | null;
    readonly corpses: readonly CorpseLoot[];
    readonly position: WorldPosition;
    readonly inventory: readonly InventoryItem[];
    readonly life: PlayerLifeState | null;
};

const setText = (element: HTMLElement, text: string): void => {
    if (element.textContent !== text) element.textContent = text;
};

const setAction = ({
    button,
    item,
    reason,
}: {
    readonly button: HTMLButtonElement;
    readonly item: Item;
    readonly reason: string | null;
}): void => {
    const label = `Взять: ${itemDisplayName(item)}`;
    if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    button.dataset['itemId'] = item.itemId;
    button.disabled = reason !== null;
};

const createPickupButton = (): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Взять';

    return button;
};

const createRow = (): LootRow => {
    const element = document.createElement('div');
    element.className = 'loot-row';
    const name = document.createElement('span');
    const button = createPickupButton();
    const reason = document.createElement('span');
    reason.className = 'loot-reason';
    element.append(name, button, reason);

    return { element, name, button, reason };
};

const createGroup = (corpse: Corpse): CorpseGroup => {
    const element = document.createElement('section');
    element.className = 'loot-group';
    element.dataset['corpseId'] = corpse.corpseId;
    const heading = document.createElement('h3');
    const { xMeters, yMeters } = corpse.position;
    heading.textContent = `Тело · ${xMeters.toFixed(1)}, ${yMeters.toFixed(1)} м`;
    element.setAttribute('aria-label', heading.textContent);
    const empty = document.createElement('p');
    empty.textContent = 'В теле ничего нет.';
    element.append(heading, empty);

    return { element, empty, rows: new Map() };
};

export const createNearbyLoot = ({
    panel,
    status,
    groundLabel,
    groundRow,
    groundButton: initialGroundButton,
    groundReason,
    corpseList,
    canReach,
    onPickup,
}: {
    readonly panel: HTMLElement;
    readonly status: HTMLElement;
    readonly groundLabel: HTMLElement;
    readonly groundRow: HTMLElement;
    readonly groundButton: HTMLButtonElement;
    readonly groundReason: HTMLElement;
    readonly corpseList: HTMLElement;
    readonly canReach: (from: WorldPosition, to: WorldPosition) => boolean;
    readonly onPickup: (itemId: string) => void;
}): { update: (state: NearbyState | null) => void; dispose: () => void } => {
    const groups = new Map<string, CorpseGroup>();
    let groundButton = initialGroundButton;
    const getReason = (state: NearbyState, target: WorldPosition, item: Item): string | null => {
        const { position, life, inventory } = state;
        if (life === null) return 'Ожидание данных персонажа…';
        if (life === 'dead') return 'Персонаж погиб.';

        const distance = Math.hypot(
            position.xMeters - target.xMeters,
            position.yMeters - target.yMeters,
        );
        if (distance > pickupSettings.rangeMeters) return 'Подойдите ближе.';
        if (!canReach(position, target)) return 'Путь к предмету перекрыт.';
        if (findInventorySpace({ items: inventory, item }) === null)
            return 'В сетке нет места или превышена допустимая масса.';

        return null;
    };
    const onClick = (event: MouseEvent): void => {
        const button = event.target;
        if (!(button instanceof HTMLButtonElement) || button.disabled) return;

        const itemId = button.dataset['itemId'];
        if (itemId !== undefined) onPickup(itemId);
    };
    panel.addEventListener('click', onClick);

    return {
        update: state => {
            const ground = state?.ground ?? null;
            const corpses = state?.corpses ?? [];
            const hasSources = ground !== null || corpses.length > 0;
            status.hidden = hasSources;
            setText(
                status,
                state === null ? 'Ожидание данных от хоста…' : 'Видимых источников нет.',
            );
            const groundText = state === null ? '—' : 'пусто';
            groundRow.hidden = ground === null;
            if (ground === null || state === null) {
                setText(groundLabel, `На земле: ${groundText}`);
                groundButton.disabled = true;
                groundButton.title = '';
                delete groundButton.dataset['itemId'];
                groundButton.removeAttribute('aria-label');
                setText(groundReason, '');
            } else {
                const { position, kind } = ground;
                setText(
                    groundLabel,
                    `На земле: ${itemDisplayName(ground)} · ${String(position.xMeters)}, ${String(position.yMeters)} м`,
                );
                const reason = getReason(state, position, ground);
                const { columns, rows } = itemDefinitions[kind];
                if (groundButton.dataset['itemId'] !== ground.itemId) {
                    const nextButton = createPickupButton();
                    nextButton.id = groundButton.id;
                    groundButton.replaceWith(nextButton);
                    groundButton = nextButton;
                }

                groundButton.title = `${itemDisplayName(ground)} · ${String(columns)} × ${String(rows)} · ${String(itemWeightGrams(ground))} г`;
                setAction({ button: groundButton, item: ground, reason });
                setText(groundReason, reason ?? '');
            }

            const visibleIds = new Set(corpses.map(corpse => corpse.corpseId));
            for (const [id, group] of groups) {
                if (visibleIds.has(id)) continue;

                group.element.remove();
                groups.delete(id);
            }

            if (state === null) return;

            for (const corpse of corpses) {
                let group = groups.get(corpse.corpseId);
                if (group === undefined) {
                    group = createGroup(corpse);
                    groups.set(corpse.corpseId, group);
                    corpseList.append(group.element);
                }

                group.empty.hidden = corpse.items.length > 0;
                const itemIds = new Set(corpse.items.map(item => item.itemId));
                for (const [id, row] of group.rows) {
                    if (itemIds.has(id)) continue;

                    row.element.remove();
                    group.rows.delete(id);
                }

                for (const item of corpse.items) {
                    let row = group.rows.get(item.itemId);
                    if (row === undefined) {
                        row = createRow();
                        group.rows.set(item.itemId, row);
                        group.element.append(row.element);
                    }

                    const reason = getReason(state, corpse.position, item);
                    setText(row.name, itemDisplayName(item));
                    setText(row.reason, reason ?? '');
                    setAction({ button: row.button, item, reason });
                }
            }
        },
        dispose: () => {
            panel.removeEventListener('click', onClick);
            corpseList.replaceChildren();
        },
    };
};
