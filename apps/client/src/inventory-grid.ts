import { inventorySettings, itemDefinitions } from '@zombi-survive/content';
import type { InventoryCell, InventoryItem } from '@zombi-survive/domain';
import { inventoryWeightGrams, placeInventoryItem } from '@zombi-survive/simulation';

export const createInventoryGrid = ({
    grid,
    selector,
    message,
    onMove,
}: {
    readonly grid: HTMLElement;
    readonly selector: HTMLButtonElement;
    readonly message: HTMLElement;
    readonly onMove: (itemId: string, cell: InventoryCell) => void;
}): { update: (items: readonly InventoryItem[] | null) => void; dispose: () => void } => {
    let items: readonly InventoryItem[] | null = null;
    let isSelected = false;
    let lastState = '';
    const cells: HTMLButtonElement[] = [];
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

    const footprint = document.createElement('span');
    footprint.className = 'inventory-item';
    footprint.textContent = 'Бинт';
    footprint.setAttribute('aria-hidden', 'true');
    footprint.hidden = true;
    grid.append(footprint);

    const update = (next: readonly InventoryItem[] | null): void => {
        const state = JSON.stringify(next);

        if (state === lastState) {
            return;
        }

        lastState = state;
        items = next;
        isSelected = false;
        selector.setAttribute('aria-pressed', 'false');
        selector.disabled = next === null || next.length === 0;
        message.textContent =
            next === null
                ? 'Сетка недоступна.'
                : `Масса: ${String(inventoryWeightGrams(next))} / ${String(inventorySettings.maxWeightGrams)} г`;

        const firstItem = next?.[0];
        footprint.hidden = firstItem === undefined;

        if (firstItem !== undefined) {
            const size = itemDefinitions[firstItem.kind];
            footprint.style.gridColumn = `${String(firstItem.cell.column + 1)} / span ${String(size.columns)}`;
            footprint.style.gridRow = `${String(firstItem.cell.row + 1)} / span ${String(size.rows)}`;
        }

        for (const button of cells) {
            button.disabled = next === null;
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
            button.setAttribute(
                'aria-description',
                item === undefined ? 'Свободно' : 'Бинт · часть предмета 2 × 1',
            );
            button.dataset['occupied'] = String(item !== undefined);
        }
    };
    const onSelect = (): void => {
        isSelected = !isSelected;
        selector.setAttribute('aria-pressed', String(isSelected));
        message.textContent = isSelected
            ? 'Выберите верхнюю левую ячейку для бинта.'
            : 'Перенос отменён.';
    };
    const onCellClick = (event: MouseEvent): void => {
        const target = event.target;
        const item = items?.[0];

        if (!isSelected || item === undefined || !(target instanceof HTMLButtonElement)) {
            return;
        }

        const cell = {
            column: Number(target.dataset['column']),
            row: Number(target.dataset['row']),
        };

        if (placeInventoryItem({ items: items ?? [], item, cell }) === null) {
            message.textContent = 'Недостаточно места: бинт занимает 2 × 1 ячейки.';

            return;
        }

        const isSameCell = cell.column === item.cell.column && cell.row === item.cell.row;

        if (isSameCell) {
            message.textContent = 'Бинт уже в этой ячейке.';

            return;
        }

        message.textContent = 'Ожидание подтверждения сервера…';
        onMove(item.itemId, cell);
    };
    selector.addEventListener('click', onSelect);
    grid.addEventListener('click', onCellClick);
    update(null);

    return {
        update,
        dispose: () => {
            selector.removeEventListener('click', onSelect);
            grid.removeEventListener('click', onCellClick);
            grid.replaceChildren();
        },
    };
};
