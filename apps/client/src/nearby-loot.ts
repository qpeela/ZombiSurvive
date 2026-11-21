import {
    itemDefinitions,
    itemDisplayName,
    itemWeightGrams,
    pickupSettings,
    workshopCrate,
} from '@zombi-survive/content';
import type {
    Corpse,
    GroundItem,
    InventoryItem,
    Item,
    PlayerLifeState,
    WorldPosition,
} from '@zombi-survive/domain';
import type { StorageLoot } from '@zombi-survive/protocol';
import { findInventorySpace } from '@zombi-survive/simulation';

import type { LootSource } from './loot-highlight';

export type CorpseLoot = Corpse & { readonly items: readonly Item[] };

type LootRow = {
    readonly element: HTMLElement;
    readonly name: HTMLElement;
    readonly button: HTMLButtonElement;
    readonly reason: HTMLElement;
};

type GroupSource = {
    readonly id: string;
    readonly position: WorldPosition;
    readonly items: readonly Item[];
    readonly kind: 'corpse' | 'storage';
};

type LootGroup = {
    readonly element: HTMLElement;
    readonly empty: HTMLElement;
    readonly capacity: HTMLElement | null;
    readonly rows: Map<string, LootRow>;
};

type NearbyState = {
    readonly ground: GroundItem | null;
    readonly corpses: readonly CorpseLoot[];
    readonly storage: StorageLoot | null;
    readonly position: WorldPosition;
    readonly inventory: readonly InventoryItem[];
    readonly life: PlayerLifeState | null;
};

export const isWithinPickupRange = (from: WorldPosition, to: WorldPosition): boolean =>
    Math.hypot(from.xMeters - to.xMeters, from.yMeters - to.yMeters) <= pickupSettings.rangeMeters;

export const getPickupReason = (
    state: Pick<NearbyState, 'position' | 'life' | 'inventory'>,
    target: WorldPosition,
    item: Item,
    canReach: (from: WorldPosition, to: WorldPosition) => boolean,
): string | null => {
    const { position, life, inventory } = state;
    if (life === null) return 'Ожидание данных персонажа…';
    if (life === 'dead') return 'Персонаж погиб.';
    if (!isWithinPickupRange(position, target)) return 'Подойдите ближе.';
    if (!canReach(position, target)) return 'Путь к предмету перекрыт.';
    if (findInventorySpace({ items: inventory, item }) === null)
        return 'В сетке нет места или превышена допустимая масса.';

    return null;
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
    element.setAttribute('role', 'group');
    const name = document.createElement('span');
    name.draggable = true;
    const button = createPickupButton();
    const reason = document.createElement('span');
    reason.className = 'loot-reason';
    element.append(name, button, reason);

    return { element, name, button, reason };
};

const createGroup = (source: GroupSource): LootGroup => {
    const element = document.createElement('section');
    element.className = 'loot-group';
    const isCorpse = source.kind === 'corpse';
    element.dataset[isCorpse ? 'corpseId' : 'storageId'] = source.id;
    const heading = document.createElement('h3');
    const { xMeters, yMeters } = source.position;
    heading.textContent = isCorpse
        ? `Тело · ${xMeters.toFixed(1)}, ${yMeters.toFixed(1)} м`
        : workshopCrate.name;
    element.setAttribute('aria-label', heading.textContent);
    const empty = document.createElement('p');
    empty.textContent = isCorpse ? 'В теле ничего нет.' : 'Ящик пуст.';
    element.append(heading, empty);
    const capacity = isCorpse ? null : document.createElement('p');
    if (capacity !== null) element.append(capacity);

    return { element, empty, capacity, rows: new Map() };
};

const getGroupSources = ({ corpses, storage }: NearbyState): GroupSource[] => {
    const sources: GroupSource[] = corpses.map(({ corpseId, position, items }) => ({
        id: corpseId,
        position,
        items,
        kind: 'corpse',
    }));
    if (storage !== null) sources.push({ ...storage, id: storage.storageId, kind: 'storage' });

    return sources;
};

const groupKey = ({ kind, id }: Pick<GroupSource, 'kind' | 'id'>): string => `${kind}:${id}`;

export const createNearbyLoot = ({
    panel,
    status,
    groundLabel,
    groundRow,
    groundButton: initialGroundButton,
    groundReason,
    corpseList,
    storageList,
    canReach,
    onPickup,
    onHighlight,
}: {
    readonly panel: HTMLElement;
    readonly status: HTMLElement;
    readonly groundLabel: HTMLElement;
    readonly groundRow: HTMLElement;
    readonly groundButton: HTMLButtonElement;
    readonly groundReason: HTMLElement;
    readonly corpseList: HTMLElement;
    readonly storageList: HTMLElement;
    readonly canReach: (from: WorldPosition, to: WorldPosition) => boolean;
    readonly onPickup: (itemId: string) => void;
    readonly onHighlight: (source: LootSource | null) => void;
}): {
    update: (state: NearbyState | null) => void;
    focusGroup: (source: Pick<GroupSource, 'kind' | 'id'>) => void;
    pickupReason: (itemId: string) => string | null;
    dispose: () => void;
} => {
    const groups = new Map<string, LootGroup>();
    let groundButton = initialGroundButton;
    let latestState: NearbyState | null = null;
    groundRow.setAttribute('role', 'group');
    groundRow.setAttribute('aria-describedby', groundReason.id);
    let pointerTarget: EventTarget | null = null;
    let isPointerPrimary = false;
    const sourceAt = (target: EventTarget | null): LootSource | null => {
        if (!(target instanceof Element) || !panel.contains(target)) return null;
        if (target.closest('[hidden]') !== null) return null;

        const isGroundRow = groundLabel.contains(target) || groundRow.contains(target);
        if (isGroundRow) {
            const id = groundButton.dataset['itemId'];

            return id === undefined ? null : { kind: 'ground', id };
        }

        const storageId = target.closest<HTMLElement>('[data-storage-id]')?.dataset['storageId'];
        if (storageId !== undefined) return { kind: 'storage', id: storageId };

        const corpse = target.closest<HTMLElement>('[data-corpse-id]');
        const corpseId = corpse?.dataset['corpseId'];

        return corpseId === undefined ? null : { kind: 'corpse', id: corpseId };
    };
    const updateHighlight = (focused: EventTarget | null = document.activeElement): void => {
        if (pointerTarget instanceof Node && !panel.contains(pointerTarget)) pointerTarget = null;

        const pointerSource = sourceAt(pointerTarget);
        const focusedSource = sourceAt(focused);
        const source = isPointerPrimary
            ? (pointerSource ?? focusedSource)
            : (focusedSource ?? pointerSource);
        onHighlight(source);
    };
    const onPointerChange = (event: PointerEvent): void => {
        pointerTarget = event.type === 'pointerover' ? event.target : event.relatedTarget;
        isPointerPrimary = true;
        updateHighlight();
    };
    const onFocusChange = (event: FocusEvent): void => {
        isPointerPrimary = false;
        updateHighlight(event.type === 'focusin' ? event.target : event.relatedTarget);
    };
    const onClick = (event: MouseEvent): void => {
        const button = event.target;
        if (!(button instanceof HTMLButtonElement) || button.disabled) return;

        const itemId = button.dataset['itemId'];
        if (itemId !== undefined) onPickup(itemId);
    };
    panel.addEventListener('click', onClick);
    panel.addEventListener('pointerover', onPointerChange);
    panel.addEventListener('pointerout', onPointerChange);
    panel.addEventListener('focusin', onFocusChange);
    panel.addEventListener('focusout', onFocusChange);

    return {
        pickupReason: itemId => {
            const state = latestState;
            if (state === null) return 'Источник больше недоступен.';
            const { ground } = state;
            if (ground?.itemId === itemId)
                return getPickupReason(state, ground.position, ground, canReach);

            for (const source of getGroupSources(state)) {
                const item = source.items.find(candidate => candidate.itemId === itemId);
                if (item !== undefined)
                    return getPickupReason(state, source.position, item, canReach);
            }

            return 'Источник больше недоступен.';
        },
        update: state => {
            latestState = state;
            const ground = state?.ground ?? null;
            const sources = state === null ? [] : getGroupSources(state);
            const hasSources = ground !== null || sources.length > 0;
            panel.toggleAttribute('data-has-sources', hasSources);
            status.hidden = hasSources;
            setText(
                status,
                state === null ? 'Ожидание данных от хоста…' : 'Видимых источников нет.',
            );
            const groundText = state === null ? '—' : 'пусто';
            groundRow.hidden = ground === null;
            if (ground === null || state === null) {
                setText(groundLabel, `На земле: ${groundText}`);
                groundLabel.draggable = false;
                delete groundLabel.dataset['lootDragId'];
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
                groundLabel.draggable = true;
                groundLabel.dataset['lootDragId'] = ground.itemId;
                const reason = getPickupReason(state, position, ground, canReach);
                const { columns, rows } = itemDefinitions[kind];
                groundRow.tabIndex = reason === null ? -1 : 0;
                groundRow.setAttribute('aria-label', `На земле: ${itemDisplayName(ground)}`);
                if (groundButton.dataset['itemId'] !== ground.itemId) {
                    if (document.activeElement === groundRow) panel.focus({ preventScroll: true });

                    const nextButton = createPickupButton();
                    nextButton.id = groundButton.id;
                    groundButton.replaceWith(nextButton);
                    groundButton = nextButton;
                }

                groundButton.title = `${itemDisplayName(ground)} · ${String(columns)} × ${String(rows)} · ${String(itemWeightGrams(ground))} г`;
                setAction({ button: groundButton, item: ground, reason });
                setText(groundReason, reason ?? '');
            }

            const visibleIds = new Set(sources.map(groupKey));
            for (const [id, group] of groups) {
                if (visibleIds.has(id)) continue;

                group.element.remove();
                groups.delete(id);
            }

            if (state === null) {
                updateHighlight();

                return;
            }

            for (const source of sources) {
                const key = groupKey(source);
                let group = groups.get(key);
                if (group === undefined) {
                    group = createGroup(source);
                    groups.set(key, group);
                    const list = source.kind === 'corpse' ? corpseList : storageList;
                    list.append(group.element);
                }

                const isEmpty = source.items.length === 0;
                group.empty.hidden = !isEmpty;
                if (group.capacity !== null) {
                    group.capacity.hidden = isEmpty;
                    setText(
                        group.capacity,
                        `Занято ${String(source.items.length)} из ${String(workshopCrate.capacity)}`,
                    );
                }
                group.element.tabIndex = isEmpty ? 0 : -1;
                const itemIds = new Set(source.items.map(item => item.itemId));
                for (const [id, row] of group.rows) {
                    if (itemIds.has(id)) continue;

                    row.element.remove();
                    group.rows.delete(id);
                }

                for (const item of source.items) {
                    let row = group.rows.get(item.itemId);
                    if (row === undefined) {
                        row = createRow();
                        group.rows.set(item.itemId, row);
                        group.element.append(row.element);
                    }

                    const reason = getPickupReason(state, source.position, item, canReach);
                    setText(row.name, itemDisplayName(item));
                    row.name.dataset['lootDragId'] = item.itemId;
                    setText(row.reason, reason ?? '');
                    row.element.tabIndex = reason === null ? -1 : 0;
                    row.element.setAttribute('aria-label', itemDisplayName(item));
                    setAction({ button: row.button, item, reason });
                }
            }
            updateHighlight();
        },
        focusGroup: source => groups.get(groupKey(source))?.element.focus(),
        dispose: () => {
            panel.removeEventListener('click', onClick);
            panel.removeEventListener('pointerover', onPointerChange);
            panel.removeEventListener('pointerout', onPointerChange);
            panel.removeEventListener('focusin', onFocusChange);
            panel.removeEventListener('focusout', onFocusChange);
            corpseList.replaceChildren();
            storageList.replaceChildren();
            onHighlight(null);
        },
    };
};
