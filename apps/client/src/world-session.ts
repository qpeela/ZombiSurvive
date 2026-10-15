export const createWorldSession = (): {
    ensure: () => Promise<void>;
    cancel: () => void;
} => {
    const invitation = new URLSearchParams(window.location.hash.slice(1)).get('invite');

    if (invitation !== null) {
        window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}`,
        );
    }

    let isRedeemed = invitation === null;
    let controller: AbortController | null = null;

    const ensure = async (): Promise<void> => {
        if (isRedeemed) {
            return;
        }

        controller?.abort();
        const current = new AbortController();
        controller = current;
        const response = await fetch('/session', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invitation }),
            signal: AbortSignal.any([current.signal, AbortSignal.timeout(10000)]),
        });
        current.signal.throwIfAborted();

        if (!response.ok) {
            throw new Error('Invitation rejected.');
        }

        isRedeemed = true;
    };
    const cancel = (): void => {
        controller?.abort();
    };

    return { ensure, cancel };
};
