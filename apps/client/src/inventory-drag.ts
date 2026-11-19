import { itemDefinitions } from '@zombi-survive/content';
import type { InventoryCell, InventoryItem } from '@zombi-survive/domain';

export const readInventoryCell = (button: HTMLButtonElement): InventoryCell => ({
    column: Number(button.dataset['column']),
    row: Number(button.dataset['row']),
});

type InventoryDrag = {
    readonly source: HTMLButtonElement;
    readonly item: InventoryItem;
    readonly grabbedCell: InventoryCell;
};

export const createInventoryDrag = ({
    grid,
    itemAt,
    canPlace,
    onMove,
}: {
    readonly grid: HTMLElement;
    readonly itemAt: (button: HTMLButtonElement) => InventoryItem | undefined;
    readonly canPlace: (item: InventoryItem, cell: InventoryCell) => boolean;
    readonly onMove: (item: InventoryItem, cell: InventoryCell) => void;
}): { sync: () => void; dispose: () => void } => {
    const preview = document.createElement('span');
    preview.className = 'inventory-drop-preview';
    preview.hidden = true;
    preview.setAttribute('aria-hidden', 'true');
    grid.append(preview);

    let drag: InventoryDrag | null = null;
    let target: HTMLButtonElement | null = null;
    const cellButton = (element: EventTarget | null): HTMLButtonElement | null =>
        element instanceof HTMLButtonElement && grid.contains(element) ? element : null;
    const cancel = (): void => {
        drag = null;
        target = null;
        preview.hidden = true;
    };
    const getPlacement = (button: HTMLButtonElement) => {
        if (drag === null) return null;

        const item = itemAt(drag.source);
        if (item?.itemId !== drag.item.itemId) return null;

        const origin = drag.item.cell;
        const hasSameOrigin = item.cell.column === origin.column && item.cell.row === origin.row;
        if (!hasSameOrigin) return null;

        const { column, row } = readInventoryCell(button);

        return {
            item,
            cell: {
                column: column - (drag.grabbedCell.column - origin.column),
                row: row - (drag.grabbedCell.row - origin.row),
            },
        };
    };
    const sync = (): void => {
        if (drag !== null && getPlacement(drag.source) === null) cancel();

        const button = target;
        const placement = button === null ? null : getPlacement(button);
        preview.hidden = placement === null;
        if (placement === null || button === null) return;

        const { item, cell } = placement;
        const { columns, rows } = itemDefinitions[item.kind];
        const hovered = readInventoryCell(button);
        const { columnGap, rowGap } = getComputedStyle(grid);
        const { left, top, width, height } = button.getBoundingClientRect();
        const gridBounds = grid.getBoundingClientRect();
        const columnStep = width + Number.parseFloat(columnGap);
        const rowStep = height + Number.parseFloat(rowGap);
        preview.style.left = `${String(left - gridBounds.left + (cell.column - hovered.column) * columnStep)}px`;
        preview.style.top = `${String(top - gridBounds.top + (cell.row - hovered.row) * rowStep)}px`;
        preview.style.width = `${String(width + (columns - 1) * columnStep)}px`;
        preview.style.height = `${String(height + (rows - 1) * rowStep)}px`;
        preview.dataset['allowed'] = String(canPlace(item, cell));
    };
    const onDragStart = (event: DragEvent): void => {
        const source = cellButton(event.target);
        const item = source === null ? undefined : itemAt(source);
        const transfer = event.dataTransfer;
        if (source === null || item === undefined || transfer === null) return;

        transfer.effectAllowed = 'move';
        transfer.setData('application/x-zombi-inventory', '');
        drag = { source, item, grabbedCell: readInventoryCell(source) };
    };
    const onDragOver = (event: DragEvent): void => {
        if (drag === null) return;

        target = cellButton(event.target);
        sync();
        if (target === null) return;

        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
    };
    const onDragLeave = (event: DragEvent): void => {
        if (cellButton(event.relatedTarget) === null) {
            target = null;
            preview.hidden = true;
        }
    };
    const onDrop = (event: DragEvent): void => {
        if (drag === null) return;

        event.preventDefault();
        const button = cellButton(event.target);
        const placement = button === null ? null : getPlacement(button);
        cancel();
        if (placement !== null) onMove(placement.item, placement.cell);
    };
    const onEscape = (event: KeyboardEvent): void => {
        if (drag === null || event.key !== 'Escape') return;

        event.preventDefault();
        cancel();
    };

    grid.addEventListener('dragstart', onDragStart);
    grid.addEventListener('dragover', onDragOver);
    grid.addEventListener('dragleave', onDragLeave);
    grid.addEventListener('drop', onDrop);
    grid.addEventListener('dragend', cancel);
    document.addEventListener('keydown', onEscape, true);

    return {
        sync,
        dispose: () => {
            grid.removeEventListener('dragstart', onDragStart);
            grid.removeEventListener('dragover', onDragOver);
            grid.removeEventListener('dragleave', onDragLeave);
            grid.removeEventListener('drop', onDrop);
            grid.removeEventListener('dragend', cancel);
            document.removeEventListener('keydown', onEscape, true);
            cancel();
            preview.remove();
        },
    };
};
