const storageKey = 'zombi-interface-scale-v1';
type InterfaceScale = 'normal' | 'large';

const readScale = (): InterfaceScale => {
    try {
        return window.localStorage.getItem(storageKey) === 'large' ? 'large' : 'normal';
    } catch {
        return 'normal';
    }
};

export const createInterfaceScale = ({
    shell,
    select,
}: {
    readonly shell: HTMLElement;
    readonly select: HTMLSelectElement;
}): { dispose: () => void } => {
    const applyScale = (scale: InterfaceScale): void => {
        shell.dataset['interfaceScale'] = scale;
        select.value = scale;
    };
    applyScale(readScale());

    const onChange = (): void => {
        const scale = select.value === 'large' ? 'large' : 'normal';
        applyScale(scale);

        try {
            window.localStorage.setItem(storageKey, scale);
        } catch {
            // Keep the preference active for the current page when storage is unavailable.
        }
    };
    select.addEventListener('change', onChange);

    return {
        dispose: () => {
            select.removeEventListener('change', onChange);
        },
    };
};
