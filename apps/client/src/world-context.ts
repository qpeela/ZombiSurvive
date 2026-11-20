import type { LootSource } from './loot-highlight';

type Target = LootSource & {
    readonly x: number;
    readonly y: number;
    readonly pointerDistance: number;
    readonly distance: number;
    readonly label: string;
    readonly reason: string | null;
};

export const createWorldContext = ({
    panel,
    title,
    action,
    reason,
    playfield,
    getTargets,
    onAction,
}: {
    readonly panel: HTMLElement;
    readonly title: HTMLElement;
    readonly action: HTMLButtonElement;
    readonly reason: HTMLElement;
    readonly playfield: HTMLElement;
    readonly getTargets: () => readonly Target[];
    readonly onAction: (target: LootSource) => void;
}): {
    open: () => void;
    close: () => boolean;
    update: () => void;
    dispose: () => void;
} => {
    let selected: LootSource | null = null;
    const readSelected = (): Target | undefined =>
        getTargets().find(target => target.kind === selected?.kind && target.id === selected.id);

    const close = (): boolean => {
        if (selected === null) return false;

        const hadFocus = panel.contains(document.activeElement);
        selected = null;
        panel.hidden = true;
        if (hadFocus) playfield.focus({ preventScroll: true });

        return true;
    };
    const render = (target: Target): void => {
        if (title.textContent !== target.label) title.textContent = target.label;
        const label = target.kind === 'ground' ? 'Взять' : 'Открыть вещи';
        if (action.textContent !== label) action.textContent = label;
        const message = target.reason ?? '';
        if (reason.textContent !== message) reason.textContent = message;
        reason.hidden = message === '';
        if (target.reason !== null && document.activeElement === action) panel.focus();
        action.disabled = target.reason !== null;
        panel.hidden = false;

        const field = playfield.getBoundingClientRect();
        const left = Math.max(field.left + 8, field.right - panel.offsetWidth - 8);
        const top = Math.max(field.top + 8, field.bottom - panel.offsetHeight - 8);
        panel.style.left = `${String(Math.min(left, Math.max(field.left + 8, target.x + 14)))}px`;
        panel.style.top = `${String(Math.min(top, Math.max(field.top + 8, target.y + 12)))}px`;
    };
    const takeAction = (): void => {
        const target = readSelected();
        if (target === undefined || target.reason !== null) return;

        close();
        onAction(target);
    };
    const onOutsidePointer = (event: PointerEvent): void => {
        if (event.target instanceof Node && !panel.contains(event.target)) close();
    };
    action.addEventListener('click', takeAction);
    document.addEventListener('pointerdown', onOutsidePointer, true);

    return {
        open: () => {
            const targets = getTargets();
            const targeted = targets
                .filter(target => Number.isFinite(target.pointerDistance))
                .reduce<Target | undefined>(
                    (best, target) =>
                        best === undefined || target.pointerDistance < best.pointerDistance
                            ? target
                            : best,
                    undefined,
                );
            const target =
                targeted ??
                targets.reduce<Target | undefined>(
                    (best, candidate) =>
                        best === undefined || candidate.distance < best.distance ? candidate : best,
                    undefined,
                );
            if (target === undefined) return;

            selected = target;
            render(target);
            (action.disabled ? panel : action).focus({ preventScroll: true });
        },
        close,
        update: () => {
            if (selected === null) return;

            const target = readSelected();
            if (target === undefined) close();
            else render(target);
        },
        dispose: () => {
            close();
            action.removeEventListener('click', takeAction);
            document.removeEventListener('pointerdown', onOutsidePointer, true);
        },
    };
};
