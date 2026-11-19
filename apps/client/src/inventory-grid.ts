import {
    inventorySettings,
    itemDefinitions,
    itemDisplayName,
    itemWeightGrams,
} from '@zombi-survive/content';
import type { InventoryCell, InventoryItem } from '@zombi-survive/domain';
import { inventoryWeightGrams, placeInventoryItem } from '@zombi-survive/simulation';

export const createInventoryGrid = ({
    grid,
    selector,
    itemSelectors,
    message,
    onMove,
}: {
    readonly grid: HTMLElement;
    readonly selector: HTMLButtonElement;
    readonly itemSelectors: HTMLElement;
    readonly message: HTMLElement;
    readonly onMove: (itemId: string, cell: InventoryCell) => void;
}): {
    selectedItem: () => InventoryItem | null;
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
    const select = (itemId: string): void => {
        selectedId = selectedId === itemId ? null : itemId;
        pendingCell = null;
        updateSelection();

        message.textContent = selectedId === null ? 'Перенос отменён.' : selectionHelp;
    };
    const update = (next: readonly InventoryItem[] | null, enabled = true): void => {
        const state = JSON.stringify([next, enabled]);

        if (state === lastState) return;

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
        const hasBandage = next?.some(item => item.kind === 'bandage') ?? false;
        selector.disabled = !hasBandage || !isEnabled;
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
                    itemButtons.set(item.itemId, button);
                    itemSelectors.append(button);
                }
                button.disabled = !isEnabled;
                button.textContent = `Переместить: ${itemDisplayName(item)} · ${String(definition.columns)} × ${String(definition.rows)} · ${String(itemWeightGrams(item))} г`;

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
            const column = Number(button.dataset['column']);
            const row = Number(button.dataset['row']);
            const item = next?.find(candidate => {
                const size = itemDefinitions[candidate.kind];
                const isColumn =
                    column >= candidate.cell.column &&
                    column < candidate.cell.column + size.columns;
                const isRow = row >= candidate.cell.row && row < candidate.cell.row + size.rows;

                return isColumn && isRow;
            });
            const definition = item === undefined ? null : itemDefinitions[item.kind];
            button.setAttribute(
                'aria-description',
                definition === null || item === undefined
                    ? 'Свободно'
                    : `${itemDisplayName(item)} · часть предмета ${String(definition.columns)} × ${String(definition.rows)}`,
            );
            button.dataset['occupied'] = String(item !== undefined);
        }
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
    const onCellClick = (event: MouseEvent): void => {
        if (!isEnabled) return;

        const target = event.target;
        const item = items?.find(candidate => candidate.itemId === selectedId);

        if (item === undefined || !(target instanceof HTMLButtonElement)) return;

        const cell = {
            column: Number(target.dataset['column']),
            row: Number(target.dataset['row']),
        };

        if (placeInventoryItem({ items: items ?? [], item, cell }) === null) {
            message.textContent = 'Недостаточно места для предмета.';

            return;
        }

        const isSameCell = cell.column === item.cell.column && cell.row === item.cell.row;

        if (isSameCell) {
            message.textContent = 'Предмет уже в этой ячейке.';

            return;
        }

        message.textContent = 'Ожидание подтверждения сервера…';
        pendingCell = cell;
        onMove(item.itemId, cell);
    };
    selector.addEventListener('click', onSelect);
    itemSelectors.addEventListener('click', onItemSelect);
    grid.addEventListener('click', onCellClick);
    update(null);

    return {
        selectedItem: () => items?.find(item => item.itemId === selectedId) ?? null,
        update,
        dispose: () => {
            selector.removeEventListener('click', onSelect);
            itemSelectors.removeEventListener('click', onItemSelect);
            grid.removeEventListener('click', onCellClick);
            grid.replaceChildren();
            itemSelectors.replaceChildren();
        },
    };
};
