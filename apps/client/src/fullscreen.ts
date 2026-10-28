export const createFullscreenControls = (options: {
    readonly container: HTMLElement;
    readonly button: HTMLButtonElement;
    readonly message: HTMLElement;
    readonly onChange: () => void;
}): { dispose: () => void } => {
    const { container, button, message, onChange } = options;
    let isPending = false;
    let isDisposed = false;
    const update = (): void => {
        const isFullscreen = document.fullscreenElement === container;
        button.textContent = isFullscreen ? 'Выйти из полного экрана' : 'На весь экран';
        button.setAttribute('aria-pressed', String(isFullscreen));
        button.disabled = isPending || !document.fullscreenEnabled;
    };
    const onFullscreenChange = (): void => {
        message.textContent = '';
        update();
        onChange();
    };
    const onClick = (): void => {
        if (isPending) {
            return;
        }

        isPending = true;
        message.textContent = '';
        update();
        const request =
            document.fullscreenElement === container
                ? document.exitFullscreen()
                : container.requestFullscreen();
        request
            .catch(() => {
                if (!isDisposed) {
                    message.textContent = 'Не удалось переключить полный экран. Играйте в окне.';
                }
            })
            .finally(() => {
                if (!isDisposed) {
                    isPending = false;
                    update();
                }
            });
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        const isExitKey = event.key === 'Escape';
        const isFullscreen = document.fullscreenElement === container;

        if (isExitKey && isFullscreen) {
            onClick();
        }
    };
    button.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    update();

    if (!document.fullscreenEnabled) {
        message.textContent = 'Полный экран недоступен в этом браузере. Играйте в окне.';
    }

    return {
        dispose: () => {
            isDisposed = true;
            button.removeEventListener('click', onClick);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('fullscreenchange', onFullscreenChange);
        },
    };
};
