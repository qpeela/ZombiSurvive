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

        expect(send).toHaveBeenLastCalledWith({ x: 0, y: 0 }, false);
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

test('clicks coalesce at ten Hz, copy the destination and stop when the server reaches it', () => {
    const send = vi.fn();
    const sendTarget = vi.fn();
    const onTargetChange = vi.fn();
    const input = createMovementInputController(send, { sendTarget, onTargetChange });
    input.moveTo({ xMeters: 1, yMeters: 2 });
    input.setEnabled(true);
    const target = { xMeters: -3, yMeters: 1.5 };
    input.moveTo(target);
    target.xMeters = 999;
    vi.advanceTimersByTime(100);
    expect(sendTarget).toHaveBeenLastCalledWith({ xMeters: -3, yMeters: 1.5 }, false);
    for (let index = 0; index < 50; index++) input.moveTo({ xMeters: 4, yMeters: -2 });
    vi.advanceTimersByTime(100);
    expect(sendTarget).toHaveBeenCalledTimes(2);
    input.updatePosition({ xMeters: 4, yMeters: -2 });
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenLastCalledWith({ x: 0, y: 0 }, false);
    expect(onTargetChange).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(1000);
    expect(sendTarget).toHaveBeenCalledTimes(2);
    input.dispose();
});

test('WASD cancels a destination and a fresh click replaces held keyboard movement', () => {
    const send = vi.fn();
    const sendTarget = vi.fn();
    const input = createMovementInputController(send, { sendTarget });
    input.setEnabled(true);
    input.moveTo({ xMeters: 3, yMeters: 4 });
    vi.advanceTimersByTime(100);
    key('KeyW');
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenLastCalledWith({ x: 0, y: -1 }, false);
    input.moveTo({ xMeters: -3, yMeters: 4 });
    key('KeyW', 'keyup');
    vi.advanceTimersByTime(100);
    expect(sendTarget).toHaveBeenLastCalledWith({ xMeters: -3, yMeters: 4 }, false);
    expect(send).toHaveBeenCalledTimes(1);
    input.dispose();
});

test.each(['blur', 'hidden', 'disconnect'])(
    '%s cancels a mouse destination without silent resume',
    reason => {
        const send = vi.fn();
        const sendTarget = vi.fn();
        const input = createMovementInputController(send, { sendTarget });
        input.setEnabled(true);
        input.moveTo({ xMeters: 100, yMeters: -100 });
        vi.advanceTimersByTime(100);
        if (reason === 'blur') windowEvents.dispatchEvent(new Event('blur'));
        if (reason === 'hidden') {
            documentEvents.hidden = true;
            documentEvents.dispatchEvent(new Event('visibilitychange'));
        }
        if (reason === 'disconnect') input.setEnabled(false);
        documentEvents.hidden = false;
        input.setEnabled(true);
        vi.advanceTimersByTime(1000);
        expect(send).toHaveBeenLastCalledWith({ x: 0, y: 0 }, false);
        expect(sendTarget).toHaveBeenCalledTimes(1);
        input.dispose();
        expect(vi.getTimerCount()).toBe(0);
    },
);

test('prediction sees key changes, clicks and cancellation before the ten Hz network send', () => {
    const send = vi.fn();
    const onIntentChange = vi.fn();
    const input = createMovementInputController(send, {
        onIntentChange,
        sendTarget: vi.fn(),
    });
    input.setEnabled(true);
    key('KeyD');
    expect(onIntentChange).toHaveBeenLastCalledWith({
        type: 'direction',
        isSprinting: false,
        direction: { x: 1, y: 0 },
    });
    expect(send).not.toHaveBeenCalled();
    // Blur before the first heartbeat also retires unsent prediction through a stop ack.
    windowEvents.dispatchEvent(new Event('blur'));
    expect(onIntentChange).toHaveBeenLastCalledWith({
        type: 'direction',
        isSprinting: false,
        direction: { x: 0, y: 0 },
    });
    expect(send).toHaveBeenLastCalledWith({ x: 0, y: 0 }, false);
    input.moveTo({ xMeters: 2, yMeters: 1 });
    expect(onIntentChange).toHaveBeenLastCalledWith({
        type: 'target',
        isSprinting: false,
        target: { xMeters: 2, yMeters: 1 },
    });
    input.dispose();
});

test('both Shift keys update prediction immediately and do not cancel the mouse target', () => {
    const send = vi.fn();
    const sendTarget = vi.fn();
    const onIntentChange = vi.fn();
    const input = createMovementInputController(send, { sendTarget, onIntentChange });
    input.setEnabled(true);
    key('KeyD');
    key('ShiftLeft');
    expect(onIntentChange).toHaveBeenLastCalledWith({
        type: 'direction',
        direction: { x: 1, y: 0 },
        isSprinting: true,
    });
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenLastCalledWith({ x: 1, y: 0 }, true);
    const target = { xMeters: 3, yMeters: 4 };
    input.moveTo(target);
    expect(onIntentChange).toHaveBeenLastCalledWith({ type: 'target', target, isSprinting: true });
    key('ShiftRight');
    key('ShiftLeft', 'keyup');
    vi.advanceTimersByTime(100);
    expect(sendTarget).toHaveBeenLastCalledWith(target, true);
    key('ShiftRight', 'keyup');
    expect(onIntentChange).toHaveBeenLastCalledWith({ type: 'target', target, isSprinting: false });
    vi.advanceTimersByTime(100);
    expect(sendTarget).toHaveBeenLastCalledWith(target, false);
    input.dispose();
});

test.each(['blur', 'hidden', 'disconnect'])(
    '%s clears sprint together with direction and destination',
    reason => {
        const send = vi.fn();
        const onIntentChange = vi.fn();
        const input = createMovementInputController(send, { onIntentChange });
        input.setEnabled(true);
        key('ShiftLeft');
        key('KeyD');
        vi.advanceTimersByTime(100);
        if (reason === 'blur') windowEvents.dispatchEvent(new Event('blur'));
        if (reason === 'hidden') {
            documentEvents.hidden = true;
            documentEvents.dispatchEvent(new Event('visibilitychange'));
        }
        if (reason === 'disconnect') input.setEnabled(false);
        expect(onIntentChange).toHaveBeenLastCalledWith({
            type: 'direction',
            direction: { x: 0, y: 0 },
            isSprinting: false,
        });
        expect(send).toHaveBeenLastCalledWith({ x: 0, y: 0 }, false);
        documentEvents.hidden = false;
        input.setEnabled(true);
        key('KeyD');
        vi.advanceTimersByTime(100);
        expect(send).toHaveBeenLastCalledWith({ x: 1, y: 0 }, false);
        input.dispose();
    },
);
