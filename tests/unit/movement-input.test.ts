/// <reference lib="dom" />
import type { MovementDirection } from '@zombi-survive/domain';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createMovementInputController } from '../../apps/client/src/movement-input.ts';

let windowEvents: EventTarget;
let documentEvents: EventTarget & { hidden: boolean };

beforeEach(() => {
    vi.useFakeTimers();
    windowEvents = Object.assign(new EventTarget(), {
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
    });
    documentEvents = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('window', windowEvents);
    vi.stubGlobal('document', documentEvents);
    vi.stubGlobal(
        'HTMLElement',
        class {
            isContentEditable = false;
            matches = () => false;
        },
    );
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
const key = (code: string, type = 'keydown', repeat = false): void => {
    windowEvents.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), {
            code,
            repeat,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
        }),
    );
};

test('physical WASD combines axes and opposing keys cancel, independently of repeat rate', () => {
    const directions: MovementDirection[] = [];
    const input = createMovementInputController(direction => directions.push(direction));
    input.setEnabled(true);
    key('KeyW');
    key('KeyA');
    key('KeyW', 'keydown', true);
    vi.advanceTimersByTime(100);
    expect(directions).toEqual([{ x: -1, y: -1 }]);
    key('KeyS');
    key('KeyD');
    vi.advanceTimersByTime(100);
    expect(directions.at(-1)).toEqual({ x: 0, y: 0 });
    key('KeyW', 'keyup');
    key('KeyA', 'keyup');
    vi.advanceTimersByTime(100);
    expect(directions.at(-1)).toEqual({ x: 1, y: 1 });
    key('KeyS', 'keyup');
    key('KeyD', 'keyup');
    vi.advanceTimersByTime(100);
    expect(directions.at(-1)).toEqual({ x: 0, y: 0 });
    input.dispose();
});

test('heartbeats stay at ten per second and key repeat cannot flood the connection', () => {
    const send = vi.fn();
    const input = createMovementInputController(send);
    input.setEnabled(true);
    key('KeyD');

    for (let frame = 0; frame < 100; frame++) {
        key('KeyD', 'keydown', true);
        vi.advanceTimersByTime(10);
    }

    expect(send).toHaveBeenCalledTimes(10);
    input.dispose();
});

test.each(['blur', 'hidden'])(
    '%s clears keys, immediately stops and cannot resume silently',
    reason => {
        const send = vi.fn();
        const input = createMovementInputController(send);
        input.setEnabled(true);
        key('KeyD');
        vi.advanceTimersByTime(100);

        if (reason === 'blur') {
            windowEvents.dispatchEvent(new Event('blur'));
        } else {
            documentEvents.hidden = true;
            documentEvents.dispatchEvent(new Event('visibilitychange'));
        }

        expect(send).toHaveBeenLastCalledWith({ x: 0, y: 0 });
        documentEvents.hidden = false;
        vi.advanceTimersByTime(1000);
        expect(send).toHaveBeenCalledTimes(2);
        input.dispose();
    },
);

test('disconnect and dispose clear intentions, listeners and timers', () => {
    const send = vi.fn();
    const input = createMovementInputController(send);
    key('KeyD');
    input.setEnabled(true);
    vi.advanceTimersByTime(100);
    expect(send).not.toHaveBeenCalled();
    key('KeyD');
    vi.advanceTimersByTime(100);
    input.setEnabled(false);
    input.setEnabled(true);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
    input.dispose();
    key('KeyW');
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
});
