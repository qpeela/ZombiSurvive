import type { WorldPosition } from '@zombi-survive/domain';
import type { MeleeAction, MeleeImpact } from '@zombi-survive/protocol';

export type MeleeEffect = {
    readonly tick: number;
    readonly impact: MeleeImpact;
    readonly ageMs: number;
};
export const meleeEffectDurationMs = 700;

/** Effects originate from an action, never from zombies disappearing in snapshots. */
export class MeleeFeedback {
    private lastTick = -1;
    effects: readonly MeleeEffect[] = [];

    accept(action: MeleeAction): void {
        if (action.tick <= this.lastTick) {
            return;
        }

        this.lastTick = action.tick;

        if (action.impact !== undefined) {
            this.effects = [
                ...this.effects,
                { tick: action.tick, impact: action.impact, ageMs: 0 },
            ];
        }
    }

    advance(options: { deltaMs: number; isLoaded: (position: WorldPosition) => boolean }): void {
        this.effects = this.effects
            .map(effect => ({ ...effect, ageMs: effect.ageMs + Math.max(0, options.deltaMs) }))
            .filter(effect => {
                const isAlive = effect.ageMs < meleeEffectDurationMs;
                const isLoaded = options.isLoaded(effect.impact.position);
                return isAlive && isLoaded;
            });
    }

    clear(): void {
        this.lastTick = -1;
        this.effects = [];
    }
}
