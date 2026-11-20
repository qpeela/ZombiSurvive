import { protocolVersion } from './movement.ts';

export type RestCommand = {
    readonly type: 'rest-at-bench' | 'cancel-rest';
    readonly protocolVersion: typeof protocolVersion;
};

export type RestCancellation = 'movement' | 'damage' | 'control';

export type RestState =
    | { readonly state: 'idle' | 'completed' }
    | {
          readonly state: 'resting';
          readonly elapsedWorldMs: number;
          readonly durationWorldMs: number;
      }
    | { readonly state: 'cancelled'; readonly reason: RestCancellation };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const isRestCommand = (value: unknown): value is RestCommand =>
    isRecord(value) &&
    value['protocolVersion'] === protocolVersion &&
    (value['type'] === 'rest-at-bench' || value['type'] === 'cancel-rest');

export const isRestState = (value: unknown): value is RestState => {
    if (!isRecord(value)) return false;
    const state = value['state'];
    if (state === 'idle' || state === 'completed') return true;
    if (state === 'cancelled') {
        const reason = value['reason'];
        return reason === 'movement' || reason === 'damage' || reason === 'control';
    }
    if (state !== 'resting') return false;

    const elapsed = value['elapsedWorldMs'];
    const duration = value['durationWorldMs'];
    const isElapsed = typeof elapsed === 'number' && Number.isSafeInteger(elapsed) && elapsed >= 0;
    const isDuration =
        typeof duration === 'number' && Number.isSafeInteger(duration) && duration > 0;
    return isElapsed && isDuration && elapsed < duration;
};
