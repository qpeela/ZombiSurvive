import type { ShotAction } from '@zombi-survive/protocol';

export const shotEffectDurationMs = 700;
export type ShotEffect = {
    readonly key: string;
    readonly action: ShotAction;
    readonly ageMs: number;
};

export class ShotFeedback {
    private readonly seen = new Set<string>();
    effects: readonly ShotEffect[] = [];

    accept(action: ShotAction): void {
        const key = `${action.itemId}:${String(action.weaponRevision)}`;

        if (this.seen.has(key)) return;

        this.seen.add(key);

        if (this.seen.size > 64) {
            const oldest = this.seen.values().next().value;
            if (oldest !== undefined) this.seen.delete(oldest);
        }

        this.effects = [...this.effects, { key, action, ageMs: 0 }].slice(-8);
    }

    advance(deltaMs: number): void {
        this.effects = this.effects
            .map(effect => ({ ...effect, ageMs: effect.ageMs + Math.max(0, deltaMs) }))
            .filter(effect => effect.ageMs < shotEffectDurationMs);
    }

    clear(): void {
        this.effects = [];
        this.seen.clear();
    }
}
