import {
    inventorySettings,
    itemDefinitions,
    itemDisplayName,
    itemWeightGrams,
} from '@zombi-survive/content';
import type { InventoryCell, InventoryItem } from '@zombi-survive/domain';
import { inventoryWeightGrams, placeInventoryItem } from '@zombi-survive/simulation';

import { createInventoryContextMenu, type InventoryContextAction } from './inventory-context-menu';
import { createInventoryDrag, readInventoryCell } from './inventory-drag';

const describeItem = (item: InventoryItem): string => {
    const { columns, rows } = itemDefinitions[item.kind];
    const details = [`${String(itemWeightGrams(item))} г`, `${String(columns)} × ${String(rows)}`];

    if (item.kind === 'ammo9mm') details.push(`Количество: ${String(item.quantity)}`);
    if (item.kind === 'pistol')
        details.push(`Магазин: ${String(item.rounds)}/${String(item.magazineCapacity)}`);

    return details.join(' · ');
};

export const createInventoryGrid = ({
    grid,
    selector,
    itemSelectors,
    message,
    details,
    panel,
    contextMenu,
    contextActions,
    onMove,
}: {
    readonly grid: HTMLElement;
    readonly selector: HTMLButtonElement;
    readonly itemSelectors: HTMLElement;
    readonly message: HTMLElement;
    readonly details: HTMLElement;
    readonly panel: HTMLElement;
    readonly contextMenu: HTMLElement;
    readonly contextActions: (item: InventoryItem) => readonly InventoryContextAction[];
    readonly onMove: (itemId: string, cell: InventoryCell) => void;
}): {
    selectedItem: () => InventoryItem | null;
    dismissContextMenu: () => boolean;
    update: (items: readonly InventoryItem[] | null, isEnabled?: boolean) => void;
    dispose: () => void;
} => {
    let items: readonly InventoryItem[] | null = null;
    let selectedId: string | null = null;
    let pendingCell: InventoryCell | null = null;
    let lastState = '';
    let isEnabled = false;
    const cells: HTMLButtonElement[] = [];
    const footprints: HTMLElement[] = [];
    const itemButtons = new Map<string, HTMLButtonElement>();
    const detailsName = document.createElement('strong');
    const detailsDescription = document.createElement('span');
    details.append(detailsName, detailsDescription);
    let pointerTarget: EventTarget | null = null;
    let isPointerPrimary = false;
    const itemIdAt = (target: EventTarget | null): string | undefined => {
        if (!(target instanceof HTMLButtonElement) || target.disabled) return undefined;
        if (target !== selector && !grid.contains(target) && !itemSelectors.contains(target))
            return undefined;

        return target.dataset['itemId'];
    };
    const updateDetails = (focused: EventTarget | null = document.activeElement): void => {
        const hoveredId = itemIdAt(pointerTarget);
        const focusedId = itemIdAt(focused);
        const itemId = isPointerPrimary ? (hoveredId ?? focusedId) : (focusedId ?? hoveredId);
        const item = isEnabled ? items?.find(candidate => candidate.itemId === itemId) : undefined;

        details.hidden = item === undefined;
        detailsName.textContent = item === undefined ? '' : itemDefinitions[item.kind].name;
        detailsDescription.textContent = item === undefined ? '' : describeItem(item);
    };
    const onPointerChange = (event: PointerEvent): void => {
        pointerTarget = event.type === 'pointerover' ? event.target : event.relatedTarget;
        isPointerPrimary = true;
        updateDetails();
    };
    const onFocusChange = (event: FocusEvent): void => {
        isPointerPrimary = false;
        updateDetails(event.type === 'focusin' ? event.target : event.relatedTarget);
    };
    const itemSurfaces = [grid, selector, itemSelectors];
    const selectionHelp = 'Выберите верхнюю левую ячейку или экипируйте выбранное оружие.';
    grid.style.setProperty('--inventory-columns', String(inventorySettings.columns));

    for (let row = 0; row < inventorySettings.rows; row++) {
        for (let column = 0; column < inventorySettings.columns; column++) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset['column'] = String(column);
            button.dataset['row'] = String(row);
            button.setAttribute('aria-label', `Ячейка ${String(column + 1)}, ${String(row + 1)}`);
            button.style.gridColumn = String(column + 1);
            button.style.gridRow = String(row + 1);
            button.disabled = true;
            grid.append(button);
            cells.push(button);
        }
    }

    const updateSelection = (): void => {
        selector.setAttribute(
            'aria-pressed',
            String(
                selectedId !== null &&
                    items?.find(item => item.itemId === selectedId)?.kind === 'bandage',
            ),
        );

        for (const [itemId, button] of itemButtons) {
            button.setAttribute('aria-pressed', String(itemId === selectedId));
        }
    };
    const setSelection = (itemId: string | null): void => {
        selectedId = itemId;
        pendingCell = null;
        updateSelection();

        message.textContent = selectedId === null ? 'Перенос отменён.' : selectionHelp;
    };
    const select = (itemId: string): void => {
        setSelection(selectedId === itemId ? null : itemId);
    };
    const canPlace = (item: InventoryItem, cell: InventoryCell): boolean =>
        isEnabled && items !== null && placeInventoryItem({ items, item, cell }) !== null;
    const hasOtherPlacement = (item: InventoryItem): boolean =>
        cells.some(button => {
            const cell = readInventoryCell(button);
            const isCurrentCell = cell.column === item.cell.column && cell.row === item.cell.row;

            return !isCurrentCell && canPlace(item, cell);
        });
    const menu = createInventoryContextMenu({
        panel,
        element: contextMenu,
        getItemId: itemIdAt,
        getItem: itemId => (isEnabled ? items?.find(item => item.itemId === itemId) : undefined),
        getActions: item => [
            ...contextActions(item),
            {
                id: 'move',
                label: 'Переместить',
                unavailable: hasOtherPlacement(item) ? null : 'Нет свободной позиции для предмета.',
                run: () => {
                    setSelection(item.itemId);
                },
            },
        ],
    });
    const update = (next: readonly InventoryItem[] | null, enabled = true): void => {
        const state = JSON.stringify([next, enabled]);

        if (state === lastState) {
            menu.refresh();

            return;
        }

        lastState = state;
        isEnabled = enabled;
        items = next;
        const selection = next?.find(item => item.itemId === selectedId);
        const moveConfirmed =
            pendingCell !== null &&
            selection?.cell.column === pendingCell.column &&
            selection.cell.row === pendingCell.row;
        if (!enabled || selection === undefined || moveConfirmed) {
            selectedId = null;
            pendingCell = null;
        }
        const bandage = next?.find(item => item.kind === 'bandage');
        selector.disabled = bandage === undefined || !isEnabled;
        selector.setAttribute('aria-haspopup', 'menu');
        if (bandage === undefined) delete selector.dataset['itemId'];
        else selector.dataset['itemId'] = bandage.itemId;
        if (next === null) message.textContent = 'Сетка недоступна.';
        else if (selectedId === null)
            message.textContent = `Масса в сетке: ${String(inventoryWeightGrams(next))} / ${String(inventorySettings.maxWeightGrams)} г`;
        else if (pendingCell === null) message.textContent = selectionHelp;
        footprints.splice(0).forEach(footprint => {
            footprint.remove();
        });
        const activeSelectors = new Set<string>();

        for (const item of next ?? []) {
            const definition = itemDefinitions[item.kind];
            const footprint = document.createElement('span');
            footprint.className = 'inventory-item';
            footprint.textContent = itemDisplayName(item);
            footprint.setAttribute('aria-hidden', 'true');
            footprint.style.gridColumn = `${String(item.cell.column + 1)} / span ${String(definition.columns)}`;
            footprint.style.gridRow = `${String(item.cell.row + 1)} / span ${String(definition.rows)}`;
            grid.append(footprint);
            footprints.push(footprint);

            const hasDuplicates =
                next?.some(candidate => {
                    const isOtherItem = candidate.itemId !== item.itemId;
                    const isSameKind = candidate.kind === item.kind;

                    return isOtherItem && isSameKind;
                }) ?? false;
            const isSelectable = item.kind !== 'bandage' || hasDuplicates;
            if (isSelectable) {
                activeSelectors.add(item.itemId);
                let button = itemButtons.get(item.itemId);
                if (button === undefined) {
                    button = document.createElement('button');
                    button.type = 'button';
                    button.dataset['itemId'] = item.itemId;
                    button.setAttribute('aria-haspopup', 'menu');
                    itemButtons.set(item.itemId, button);
                    itemSelectors.append(button);
                }
                button.disabled = !isEnabled;
                button.textContent = `Переместить: ${itemDisplayName(item)} · ${String(definition.columns)} × ${String(definition.rows)} · ${String(itemWeightGrams(item))} г`;
                if (item.kind === 'pistol')
                    button.setAttribute(
                        'aria-description',
                        `Магазин: ${String(item.rounds)}/${String(item.magazineCapacity)}`,
                    );

                if (hasDuplicates) {
                    button.textContent += ` · ячейка ${String(item.cell.column + 1)}, ${String(item.cell.row + 1)}`;
                }
            }
        }

        for (const [itemId, button] of itemButtons) {
            if (activeSelectors.has(itemId)) continue;
            button.remove();
            itemButtons.delete(itemId);
        }
        updateSelection();

        for (const button of cells) {
            button.disabled = next === null || !isEnabled;
            const { column, row } = readInventoryCell(button);
            const item = next?.find(candidate => {
                const size = itemDefinitions[candidate.kind];
                const isColumn =
                    column >= candidate.cell.column &&
                    column < candidate.cell.column + size.columns;
                const isRow = row >= candidate.cell.row && row < candidate.cell.row + size.rows;

                return isColumn && isRow;
            });
            button.setAttribute(
                'aria-description',
                item === undefined
                    ? 'Свободно'
                    : `${itemDefinitions[item.kind].name} · ${describeItem(item)}`,
            );
            button.dataset['occupied'] = String(item !== undefined);
            button.draggable = isEnabled && item !== undefined;
            if (item === undefined) {
                delete button.dataset['itemId'];
                button.removeAttribute('aria-haspopup');
            } else {
                button.dataset['itemId'] = item.itemId;
                button.setAttribute('aria-haspopup', 'menu');
            }
        }

        if (!enabled) pointerTarget = null;
        updateDetails();
        drag.sync();
        menu.refresh();
    };
    const onSelect = (): void => {
        if (!isEnabled) return;

        const bandage = items?.find(item => item.kind === 'bandage');

        if (bandage !== undefined) select(bandage.itemId);
    };
    const onItemSelect = (event: MouseEvent): void => {
        if (!isEnabled) return;

        const target = event.target;

        if (!(target instanceof HTMLButtonElement)) return;

        const itemId = target.dataset['itemId'];

        if (itemId !== undefined) select(itemId);
    };
    const requestMove = ({
        item,
        cell,
        isKeyboard,
    }: {
        readonly item: InventoryItem;
        readonly cell: InventoryCell;
        readonly isKeyboard: boolean;
    }): void => {
        if (!canPlace(item, cell)) {
            if (isKeyboard) message.textContent = 'Недостаточно места для предмета.';

            return;
        }

        const isSameCell = cell.column === item.cell.column && cell.row === item.cell.row;

        if (isSameCell) {
            if (isKeyboard) message.textContent = 'Предмет уже в этой ячейке.';

            return;
        }

        if (isKeyboard) {
            message.textContent = 'Ожидание подтверждения сервера…';
            pendingCell = cell;
        }

        onMove(item.itemId, cell);
    };
    const onCellClick = (event: MouseEvent): void => {
        if (!isEnabled) return;

        const target = event.target;
        const item = items?.find(candidate => candidate.itemId === selectedId);
        if (item === undefined || !(target instanceof HTMLButtonElement)) return;

        requestMove({ item, cell: readInventoryCell(target), isKeyboard: true });
    };
    const drag = createInventoryDrag({
        grid,
        itemAt: button => {
            const itemId = itemIdAt(button);

            return items?.find(item => item.itemId === itemId);
        },
        canPlace,
        onMove: (item, cell) => {
            requestMove({ item, cell, isKeyboard: false });
        },
    });
    selector.addEventListener('click', onSelect);
    itemSelectors.addEventListener('click', onItemSelect);
    grid.addEventListener('click', onCellClick);
    for (const surface of itemSurfaces) {
        surface.addEventListener('pointerover', onPointerChange);
        surface.addEventListener('pointerout', onPointerChange);
        surface.addEventListener('focusin', onFocusChange);
        surface.addEventListener('focusout', onFocusChange);
    }
    update(null);

    return {
        selectedItem: () => items?.find(item => item.itemId === selectedId) ?? null,
        dismissContextMenu: menu.dismiss,
        update,
        dispose: () => {
            selector.removeEventListener('click', onSelect);
            itemSelectors.removeEventListener('click', onItemSelect);
            grid.removeEventListener('click', onCellClick);
            for (const surface of itemSurfaces) {
                surface.removeEventListener('pointerover', onPointerChange);
                surface.removeEventListener('pointerout', onPointerChange);
                surface.removeEventListener('focusin', onFocusChange);
                surface.removeEventListener('focusout', onFocusChange);
            }
            drag.dispose();
            menu.dispose();
            grid.replaceChildren();
            itemSelectors.replaceChildren();
            details.hidden = true;
            details.replaceChildren();
        },
    };
};
