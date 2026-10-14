import type { MovementAxis, MovementDirection } from '@zombi-survive/domain';

const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const axis = (positive: boolean, negative: boolean): MovementAxis => {
    if (positive === negative) {
        return 0;
    }

    return positive ? 1 : -1;
};

export const createMovementInputController = (
    send: (direction: MovementDirection) => void,
): { setEnabled: (isEnabled: boolean) => void; dispose: () => void } => {
    const pressed = new Set<string>();
    let isEnabled = false;
    let isDirty = false;
    let isMoving = false;

    const clear = (): void => {
        pressed.clear();
        isDirty = false;

        if (isEnabled && isMoving) {
            send({ x: 0, y: 0 });
        }

        isMoving = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        const isMovementKey = movementCodes.has(event.code);
        const isModified = event.altKey || event.ctrlKey || event.metaKey;
        const isEditing =
            event.target instanceof HTMLElement &&
            (event.target.isContentEditable || event.target.matches('input, textarea, select'));

        if (!isEnabled || !isMovementKey || isModified || isEditing || document.hidden) {
            return;
        }

        event.preventDefault();

        if (!event.repeat) {
            pressed.add(event.code);
            isDirty = true;
        }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
        if (pressed.delete(event.code)) {
            event.preventDefault();
            isDirty = true;
        }
    };
    const onVisibilityChange = (): void => {
        if (document.hidden) {
            clear();
        }
    };
    const interval = window.setInterval(() => {
        if (!isEnabled) {
            return;
        }

        const direction = {
            x: axis(pressed.has('KeyD'), pressed.has('KeyA')),
            y: axis(pressed.has('KeyS'), pressed.has('KeyW')),
        };
        const hasDirection = direction.x !== 0 || direction.y !== 0;

        if (isDirty || hasDirection) {
            isDirty = false;
            isMoving = hasDirection;
            send(direction);
        }
    }, 100);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const setEnabled = (value: boolean): void => {
        if (value === isEnabled) {
            return;
        }

        clear();
        isEnabled = value;
    };
    const dispose = (): void => {
        clear();
        window.clearInterval(interval);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', clear);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };

    return { setEnabled, dispose };
};
