type ControlPanel = {
    readonly element: HTMLElement;
    readonly button: HTMLButtonElement;
    readonly shortcut: string;
};

type OpenPanel = {
    readonly panel: ControlPanel;
    readonly opener: HTMLElement;
};

type PreserveFocus = <Value>(update: (value: Value) => void) => (value: Value) => void;

export const createControlPanels = ({
    shell,
    playfield,
    panels,
    resetInput,
}: {
    readonly shell: HTMLElement;
    readonly playfield: HTMLElement;
    readonly panels: readonly ControlPanel[];
    readonly resetInput: () => void;
}): { preserveFocus: PreserveFocus; dispose: () => void } => {
    const openPanels: OpenPanel[] = [];
    const panelContaining = (target: EventTarget | null): ControlPanel | undefined =>
        target instanceof Node ? panels.find(({ element }) => element.contains(target)) : undefined;
    const ownsInput = (target: EventTarget | null): boolean =>
        panelContaining(target) !== undefined || panels.some(({ button }) => button === target);

    const close = (index: number, focus?: HTMLElement | 'keep'): void => {
        const entry = openPanels[index];
        if (entry === undefined) return;

        const hadFocus = panelContaining(document.activeElement) === entry.panel;
        openPanels.splice(index, 1);
        entry.panel.element.hidden = true;
        entry.panel.button.setAttribute('aria-expanded', 'false');
        if (focus === 'keep' && !hadFocus) return;

        const opener = focus instanceof HTMLElement ? focus : entry.opener;
        const fallback = openPanels.at(-1)?.panel.element ?? playfield;
        if (
            opener.isConnected &&
            opener.closest('[hidden]') === null &&
            !opener.matches(':disabled')
        ) {
            opener.focus();
            if (document.activeElement === opener) return;
        }

        fallback.focus();
    };

    const toggle = (panel: ControlPanel, opener: HTMLElement): void => {
        const index = openPanels.findIndex(entry => entry.panel === panel);
        if (index >= 0) {
            close(index, opener === panel.button ? opener : 'keep');

            return;
        }

        openPanels.push({ panel, opener });
        panel.element.hidden = false;
        panel.button.setAttribute('aria-expanded', 'true');
        panel.element.focus();
    };

    const onShortcut = (event: KeyboardEvent): void => {
        if (event.defaultPrevented || event.isComposing) return;

        if (event.key === 'Escape' && openPanels.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) close(openPanels.length - 1);

            return;
        }

        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

        const target = event.target;
        if (
            target instanceof HTMLElement &&
            (target.isContentEditable || target.matches('input, textarea, select'))
        ) {
            return;
        }

        const panel = panels.find(candidate => candidate.shortcut === event.code);
        if (panel === undefined) return;

        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
            toggle(
                panel,
                target instanceof HTMLElement && target !== document.body ? target : playfield,
            );
        }
    };
    const onUiKey = (event: KeyboardEvent): void => {
        if (ownsInput(event.target)) event.stopPropagation();
    };
    const onFocusIn = (event: FocusEvent): void => {
        if (ownsInput(event.target) && !ownsInput(event.relatedTarget)) resetInput();
    };

    const listeners = panels.map(panel => {
        const onClick = (): void => {
            toggle(panel, panel.button);
        };
        panel.button.addEventListener('click', onClick);

        return { button: panel.button, onClick };
    });
    document.addEventListener('keydown', onShortcut, true);
    shell.addEventListener('keydown', onUiKey);
    shell.addEventListener('focusin', onFocusIn);

    return {
        preserveFocus: update => value => {
            const focused = document.activeElement;
            const panel = panelContaining(focused);
            try {
                update(value);
            } finally {
                if (
                    focused !== null &&
                    panel?.element.hidden === false &&
                    (!focused.isConnected || focused.matches(':disabled'))
                ) {
                    panel.element.focus();
                }
            }
        },
        dispose: () => {
            document.removeEventListener('keydown', onShortcut, true);
            shell.removeEventListener('keydown', onUiKey);
            shell.removeEventListener('focusin', onFocusIn);
            for (const { button, onClick } of listeners)
                button.removeEventListener('click', onClick);
            for (const { panel } of openPanels) {
                panel.element.hidden = true;
                panel.button.setAttribute('aria-expanded', 'false');
            }
        },
    };
};
