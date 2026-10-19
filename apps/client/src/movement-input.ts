import type {
    MovementAxis,
    MovementDirection,
    MovementModifiers,
    WorldPosition,
} from '@zombi-survive/domain';

import type { MovementIntent } from './movement-prediction.js';

const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const sprintCodes = new Set(['ShiftLeft', 'ShiftRight']);
const sneakCodes = new Set(['ControlLeft', 'ControlRight']);
const axis = (positive: boolean, negative: boolean): MovementAxis => {
    if (positive === negative) {
        return 0;
    }

    return positive ? 1 : -1;
};

export const createMovementInputController = (
    send: (direction: MovementDirection, modifiers: MovementModifiers) => void,
    options: {
        readonly sendTarget?: (target: WorldPosition, modifiers: MovementModifiers) => void;
        readonly onIntentChange?: (intent: MovementIntent) => void;
        readonly onTargetChange?: (target: WorldPosition | null) => void;
    } = {},
): {
    setEnabled: (isEnabled: boolean) => void;
    moveTo: (target: WorldPosition) => void;
    updatePosition: (position: WorldPosition) => void;
    dispose: () => void;
} => {
    const pressed = new Set<string>();
    let isEnabled = false;
    let isDirty = false;
    let isMoving = false;
    let target: WorldPosition | null = null;

    const setTarget = (value: WorldPosition | null): void => {
        target = value;
        options.onTargetChange?.(value);
    };

    const direction = (): MovementDirection => ({
        x: axis(pressed.has('KeyD'), pressed.has('KeyA')),
        y: axis(pressed.has('KeyS'), pressed.has('KeyW')),
    });
    const modifiers = (): Required<MovementModifiers> => ({
        isSprinting: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
        isSneaking: pressed.has('ControlLeft') || pressed.has('ControlRight'),
    });
    const notifyIntent = (): void => {
        const currentModifiers = modifiers();
        const intent: MovementIntent =
            target === null
                ? { type: 'direction', direction: direction(), ...currentModifiers }
                : { type: 'target', target: { ...target }, ...currentModifiers };
        options.onIntentChange?.(intent);
    };

    const clear = (): void => {
        const hasInput = isMoving || isDirty || target !== null || pressed.size > 0;
        pressed.clear();
        isDirty = false;
        setTarget(null);
        notifyIntent();

        if (isEnabled && hasInput) {
            send({ x: 0, y: 0 }, modifiers());
        }

        isMoving = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        const isMovementKey = movementCodes.has(event.code);
        const isInputKey =
            isMovementKey || sprintCodes.has(event.code) || sneakCodes.has(event.code);
        const isModified = event.altKey || event.metaKey;
        const isEditing =
            event.target instanceof HTMLElement &&
            (event.target.isContentEditable || event.target.matches('input, textarea, select'));

        if (!isEnabled || !isInputKey || isModified || isEditing || document.hidden) {
            return;
        }

        event.preventDefault();

        if (!event.repeat) {
            if (isMovementKey) {
                setTarget(null);
            }

            pressed.add(event.code);
            isDirty = true;
            notifyIntent();
        }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
        if (pressed.delete(event.code)) {
            event.preventDefault();
            isDirty = true;

            notifyIntent();
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

        if (target !== null) {
            isDirty = false;
            isMoving = true;
            options.sendTarget?.(target, modifiers());

            return;
        }

        const currentDirection = direction();
        const hasDirection = currentDirection.x !== 0 || currentDirection.y !== 0;

        if (isDirty || hasDirection || modifiers().isSneaking) {
            isDirty = false;
            isMoving = hasDirection;
            send(currentDirection, modifiers());
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

    const moveTo = (value: WorldPosition): void => {
        if (!isEnabled || document.hidden || options.sendTarget === undefined) {
            return;
        }

        for (const code of movementCodes) {
            pressed.delete(code);
        }

        setTarget({ ...value });
        notifyIntent();
    };
    const updatePosition = (position: WorldPosition): void => {
        if (target === null) {
            return;
        }

        const distance = Math.hypot(
            target.xMeters - position.xMeters,
            target.yMeters - position.yMeters,
        );

        if (distance <= 0.000001) {
            setTarget(null);
            isDirty = true;
            notifyIntent();
        }
    };

    return { setEnabled, moveTo, updatePosition, dispose };
};
