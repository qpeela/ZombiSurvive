import { itemDisplayName } from '@zombi-survive/content';
import type { InventoryItem } from '@zombi-survive/domain';

export type InventoryContextAction = {
    readonly id: string;
    readonly label: string;
    readonly unavailable: string | null;
    readonly run: () => void;
};

type ActionView = {
    readonly row: HTMLElement;
    readonly button: HTMLButtonElement;
    readonly reason: HTMLElement;
};

export const createInventoryContextMenu = ({
    panel,
    element,
    getItemId,
    getItem,
    getActions,
}: {
    readonly panel: HTMLElement;
    readonly element: HTMLElement;
    readonly getItemId: (target: EventTarget | null) => string | undefined;
    readonly getItem: (itemId: string) => InventoryItem | undefined;
    readonly getActions: (item: InventoryItem) => readonly InventoryContextAction[];
}): { refresh: () => void; dismiss: () => boolean; dispose: () => void } => {
    const heading = document.createElement('strong');
    heading.id = `${element.id}-heading`;
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', heading.id);
    element.append(heading, menu);
    let open: { readonly itemId: string; readonly trigger: HTMLButtonElement } | null = null;
    const views = new Map<string, ActionView>();

    const close = (restoreFocus: boolean): void => {
        const previous = open;
        if (previous === null) return;

        open = null;
        previous.trigger.removeAttribute('aria-expanded');
        element.hidden = true;
        menu.replaceChildren();
        views.clear();
        if (!restoreFocus || panel.hidden !== false) return;

        const matchesItem = getItemId(previous.trigger) === previous.itemId;
        const focus = matchesItem ? previous.trigger : panel;
        focus.focus({ preventScroll: true });
    };
    const refresh = (): void => {
        if (open === null) return;

        const item = getItem(open.itemId);
        const matchesTrigger = getItemId(open.trigger) === open.itemId;
        if (panel.hidden !== false || item === undefined || !matchesTrigger) {
            close(element.contains(document.activeElement));

            return;
        }

        const { column, row } = item.cell;
        const title = `${itemDisplayName(item)} · ячейка ${String(column + 1)}, ${String(row + 1)}`;
        if (heading.textContent !== title) heading.textContent = title;

        const actions = getActions(item);
        const ids = new Set(actions.map(action => action.id));
        for (const [id, view] of views) {
            if (ids.has(id)) continue;

            view.row.remove();
            views.delete(id);
        }

        for (const { id, label, unavailable } of actions) {
            let view = views.get(id);
            if (view === undefined) {
                const row = document.createElement('div');
                row.setAttribute('role', 'none');
                const button = document.createElement('button');
                button.type = 'button';
                button.tabIndex = -1;
                button.dataset['action'] = id;
                button.setAttribute('role', 'menuitem');
                button.textContent = label;
                const reason = document.createElement('span');
                reason.id = `${element.id}-${id}-reason`;
                row.append(button, reason);
                menu.append(row);
                view = { row, button, reason };
                views.set(id, view);
            }

            view.button.setAttribute('aria-disabled', String(unavailable !== null));
            view.reason.hidden = unavailable === null;
            if (unavailable === null) view.button.removeAttribute('aria-describedby');
            else view.button.setAttribute('aria-describedby', view.reason.id);
            if (view.reason.textContent !== (unavailable ?? ''))
                view.reason.textContent = unavailable ?? '';
        }
    };
    const show = (event: Event): void => {
        const trigger = event.target;
        if (!(trigger instanceof HTMLButtonElement)) return;

        const itemId = getItemId(trigger);
        if (itemId === undefined || getItem(itemId) === undefined) return;

        event.preventDefault();
        close(false);
        open = { itemId, trigger };
        trigger.setAttribute('aria-expanded', 'true');
        element.hidden = false;
        refresh();
        views.values().next().value?.button.focus({ preventScroll: true });
    };
    const onContextShortcut = (event: KeyboardEvent): void => {
        if (event.defaultPrevented || event.isComposing || event.repeat) return;

        const isKeyboardContext =
            event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
        if (isKeyboardContext) show(event);
    };
    const onOutsidePointer = (event: PointerEvent): void => {
        const target = event.target;
        if (target instanceof Node && !element.contains(target)) close(false);
    };
    const onFocusOut = (event: FocusEvent): void => {
        const target = event.relatedTarget;
        if (!(target instanceof Node) || !element.contains(target)) close(false);
    };
    const onMenuKey = (event: KeyboardEvent): void => {
        const buttons = Array.from(views.values(), view => view.button);
        const focusedIndex = buttons.findIndex(button => button === event.target);
        if (focusedIndex < 0) return;

        let index = focusedIndex;
        if (event.key === 'ArrowDown') index = (index + 1) % buttons.length;
        else if (event.key === 'ArrowUp') index = (index + buttons.length - 1) % buttons.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else return;

        event.preventDefault();
        buttons[index]?.focus();
    };
    const onClick = (event: MouseEvent): void => {
        const target = event.target;
        if (open === null || !(target instanceof HTMLButtonElement)) return;

        const item = getItem(open.itemId);
        const action =
            item === undefined
                ? undefined
                : getActions(item).find(candidate => candidate.id === target.dataset['action']);
        if (action === undefined || action.unavailable !== null) return;

        close(true);
        action.run();
    };

    panel.addEventListener('contextmenu', show);
    panel.addEventListener('keydown', onContextShortcut);
    menu.addEventListener('keydown', onMenuKey);
    menu.addEventListener('focusout', onFocusOut);
    menu.addEventListener('click', onClick);
    document.addEventListener('pointerdown', onOutsidePointer, true);

    return {
        refresh,
        dismiss: () => {
            if (open === null) return false;

            close(true);

            return true;
        },
        dispose: () => {
            panel.removeEventListener('contextmenu', show);
            panel.removeEventListener('keydown', onContextShortcut);
            menu.removeEventListener('keydown', onMenuKey);
            menu.removeEventListener('focusout', onFocusOut);
            menu.removeEventListener('click', onClick);
            document.removeEventListener('pointerdown', onOutsidePointer, true);
            close(false);
            element.replaceChildren();
        },
    };
};
