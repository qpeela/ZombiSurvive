import { pickupSettings, restSettings, workshopBench } from '@zombi-survive/content';
import type { WorldPosition } from '@zombi-survive/domain';
import type { RestCancellation, RestState } from '@zombi-survive/protocol';
import { resolveMovement } from '@zombi-survive/simulation';
import { loadWorldChunks } from '@zombi-survive/worldgen';

type RestPlayer = { readonly position: WorldPosition; readonly health: number };
type ActiveRest = RestPlayer & { readonly sessionId: string; readonly startedAtWorldMs: number };
type RestOutcome =
    | { readonly state: 'completed' }
    | { readonly state: 'cancelled'; readonly reason: RestCancellation };

const distance = (from: WorldPosition, to: WorldPosition): number =>
    Math.hypot(from.xMeters - to.xMeters, from.yMeters - to.yMeters);

const isBenchReachable = (position: WorldPosition): boolean => {
    const bench = workshopBench.position;
    if (distance(position, bench) > pickupSettings.rangeMeters) return false;

    const obstacles = loadWorldChunks({
        positions: [position, bench],
        previousChunks: [],
    }).flatMap(chunk => chunk.obstacles);
    return distance(resolveMovement(position, bench, obstacles), bench) < 1e-8;
};

export class LocalWorldRest {
    private requestedBy: string | null = null;
    private active: ActiveRest | null = null;
    private outcome: RestOutcome | null = null;
    private feedbackUntilMs = 0;

    request(sessionId: string): void {
        if (this.active === null && this.requestedBy === null) this.requestedBy = sessionId;
    }

    loseControl(sessionId: string, worldTimeMs: number): void {
        if (sessionId === this.requestedBy) this.requestedBy = null;
        if (sessionId === this.active?.sessionId) this.cancel('control', worldTimeMs);
    }

    reset(): void {
        this.requestedBy = null;
        this.active = null;
        this.outcome = null;
    }

    step({
        worldTimeMs,
        fatigueMs,
        playerFor,
    }: {
        readonly worldTimeMs: number;
        readonly fatigueMs: number;
        readonly playerFor: (sessionId: string) => RestPlayer | undefined;
    }): boolean {
        const active = this.active;
        if (active === null) {
            const sessionId = this.requestedBy;
            this.requestedBy = null;
            if (sessionId === null || fatigueMs <= restSettings.restedFatigueMs) return false;

            const player = playerFor(sessionId);
            if (player === undefined || player.health <= 0 || !isBenchReachable(player.position))
                return false;

            this.active = {
                ...player,
                position: { ...player.position },
                sessionId,
                startedAtWorldMs: worldTimeMs,
            };
            this.outcome = null;
            return false;
        }

        const player = playerFor(active.sessionId);
        if (player === undefined) {
            this.cancel('control', worldTimeMs);
            return false;
        }
        if (player.health < active.health) {
            this.cancel('damage', worldTimeMs);
            return false;
        }
        if (distance(player.position, active.position) > 1e-6) {
            this.cancel('movement', worldTimeMs);
            return false;
        }
        if (worldTimeMs - active.startedAtWorldMs < restSettings.durationWorldMs) return false;

        this.active = null;
        this.outcome = { state: 'completed' };
        this.feedbackUntilMs = worldTimeMs + restSettings.feedbackWorldMs;
        return true;
    }

    snapshot(worldTimeMs: number): RestState {
        if (this.active !== null)
            return {
                state: 'resting',
                elapsedWorldMs: worldTimeMs - this.active.startedAtWorldMs,
                durationWorldMs: restSettings.durationWorldMs,
            };
        return this.outcome !== null && worldTimeMs < this.feedbackUntilMs
            ? this.outcome
            : { state: 'idle' };
    }

    private cancel(reason: RestCancellation, worldTimeMs: number): void {
        this.active = null;
        this.outcome = { state: 'cancelled', reason };
        this.feedbackUntilMs = worldTimeMs + restSettings.feedbackWorldMs;
    }
}
