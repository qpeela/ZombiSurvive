import { prototypeObstacles } from '@zombi-survive/content';
import type { MovementDirection, PlayerMovementState, WorldPosition } from '@zombi-survive/domain';
import type {
    MovementInputCommand,
    MovementSnapshot,
    MovementTargetCommand,
} from '@zombi-survive/protocol';
import {
    movementStepSeconds,
    resolveMovement,
    stepPlayerMovement,
    stepPlayerToward,
} from '@zombi-survive/simulation';

export type MovementIntent =
    | {
          readonly type: 'direction';
          readonly direction: MovementDirection;
          readonly isSprinting: boolean;
          readonly isSneaking: boolean;
      }
    | {
          readonly type: 'target';
          readonly target: WorldPosition;
          readonly isSprinting: boolean;
          readonly isSneaking: boolean;
      };

type InputEntry = {
    readonly intent: MovementIntent;
    readonly atMs: number;
    sequence: number | null;
    sentAtMs: number | null;
};

const stopped: MovementIntent = {
    type: 'direction',
    direction: { x: 0, y: 0 },
    isSprinting: false,
    isSneaking: false,
};
const stepMs = movementStepSeconds * 1000;
const horizonMs = 500;
const maxHistory = 64;
const copyIntent = (intent: MovementIntent): MovementIntent => {
    if (intent.type === 'target') {
        return { ...intent, target: { ...intent.target } };
    }

    return { ...intent, direction: { ...intent.direction } };
};
const sameIntent = (first: MovementIntent, second: MovementIntent): boolean => {
    const isSameSprint = first.isSprinting === second.isSprinting;
    const isSameStealth = first.isSneaking === second.isSneaking;

    if (!isSameSprint || !isSameStealth) {
        return false;
    }

    if (first.type === 'target' && second.type === 'target') {
        return (
            first.target.xMeters === second.target.xMeters &&
            first.target.yMeters === second.target.yMeters
        );
    }

    if (first.type === 'direction' && second.type === 'direction') {
        return first.direction.x === second.direction.x && first.direction.y === second.direction.y;
    }

    return false;
};

// Local time is injected. Snapshots remain authoritative; intentions are held states,
// never one movement step per packet. No browser or transport lifecycle lives here.
export class MovementPrediction {
    private snapshot: MovementSnapshot | null = null;
    private receivedAtMs = 0;
    private oneWayMs = 0;
    private acknowledged: InputEntry | null = null;
    private pending: InputEntry[] = [];
    private isSuspended = false;

    reset(): void {
        this.snapshot = null;
        this.pending = [];
        this.acknowledged = null;
        this.oneWayMs = 0;
        this.isSuspended = false;
    }

    setIntent(intent: MovementIntent, nowMs: number): void {
        if (this.snapshot === null || this.isSuspended) {
            return;
        }

        const latest = this.pending.at(-1) ?? this.acknowledged;

        if (latest !== null && sameIntent(latest.intent, intent)) {
            return;
        }

        this.pending.push({
            intent: copyIntent(intent),
            atMs: nowMs,
            sequence: null,
            sentAtMs: null,
        });
        this.limitHistory();
    }

    recordSent(command: MovementInputCommand | MovementTargetCommand, nowMs: number): void {
        if (this.snapshot === null || this.isSuspended) {
            return;
        }

        const intent: MovementIntent =
            command.type === 'movement-input'
                ? {
                      type: 'direction',
                      direction: command.direction,
                      isSprinting: command.isSprinting,
                      isSneaking: command.isSneaking,
                  }
                : {
                      type: 'target',
                      target: command.target,
                      isSprinting: command.isSprinting,
                      isSneaking: command.isSneaking,
                  };
        const latest = this.pending.at(-1);
        const isUnsent = latest !== undefined && latest.sequence === null;

        if (isUnsent && sameIntent(latest.intent, intent)) {
            latest.sequence = command.sequence;
            latest.sentAtMs = nowMs;
        } else {
            this.pending.push({
                intent: copyIntent(intent),
                atMs: nowMs,
                sequence: command.sequence,
                sentAtMs: nowMs,
            });
        }

        this.limitHistory();
    }

    accept(snapshot: MovementSnapshot, nowMs: number): void {
        if (this.snapshot !== null) {
            const isSameWorld = snapshot.worldId === this.snapshot.worldId;
            const isSamePlayer = snapshot.player.playerId === this.snapshot.player.playerId;

            if (!isSameWorld || !isSamePlayer) {
                this.reset();
            } else if (snapshot.tick <= this.snapshot.tick) {
                return;
            }
        }

        const ack = snapshot.lastProcessedInputSequence;
        const index = this.pending.findIndex(entry => entry.sequence === ack && ack !== null);
        const entry = this.pending[index];

        if (entry !== undefined) {
            if (entry.sentAtMs !== null) {
                // Includes scheduling/transport time; this is a bounded estimate, not server time.
                this.oneWayMs = Math.min(horizonMs / 2, Math.max(0, nowMs - entry.sentAtMs) / 2);
            }

            this.acknowledged = entry;
            this.pending.splice(0, index + 1);
        }

        this.snapshot = snapshot;
        this.receivedAtMs = nowMs;
    }

    sample(nowMs: number): PlayerMovementState | null {
        const snapshot = this.snapshot;

        if (snapshot === null) {
            return null;
        }

        const hasLocalIntent = this.acknowledged !== null || this.pending.length > 0;

        if (this.isSuspended || !hasLocalIntent) {
            // Another tab may own this character. Without local intent keep its authoritative mode.
            return snapshot.player;
        }

        // Unacknowledged intentions must be replayed even while old snapshots arrive.
        const oldest = this.pending[0];
        const pendingAgeMs = oldest === undefined ? 0 : this.receivedAtMs - oldest.atMs;
        const leadMs = Math.max(this.oneWayMs, pendingAgeMs, 0);
        const startMs = this.receivedAtMs - leadMs;
        const endMs = Math.min(nowMs, startMs + horizonMs);
        let player = snapshot.player;
        let intent = this.acknowledged?.intent ?? stopped;
        let refreshedAtMs = this.acknowledged?.sentAtMs ?? -Infinity;
        let index = 0;

        for (let atMs = startMs; atMs < endMs; atMs += stepMs) {
            // Include input at the start of this step. Faster UI changes coalesce.
            while (index < this.pending.length) {
                const entry = this.pending[index];

                if (entry === undefined || entry.atMs > atMs) {
                    break;
                }

                intent = entry.intent;
                refreshedAtMs = entry.sentAtMs ?? entry.atMs;
                index++;
            }

            const isExpired = atMs - refreshedAtMs >= horizonMs;
            const activeIntent = isExpired ? stopped : intent;
            const next =
                activeIntent.type === 'target'
                    ? stepPlayerToward(
                          player,
                          activeIntent.target,
                          movementStepSeconds,
                          activeIntent,
                      )
                    : stepPlayerMovement(
                          player,
                          activeIntent.direction,
                          movementStepSeconds,
                          activeIntent,
                      );
            const fraction = Math.min(1, (endMs - atMs) / stepMs);
            const desired = {
                xMeters:
                    player.position.xMeters +
                    (next.position.xMeters - player.position.xMeters) * fraction,
                yMeters:
                    player.position.yMeters +
                    (next.position.yMeters - player.position.yMeters) * fraction,
            };
            const position = resolveMovement(player.position, desired, prototypeObstacles);
            const hasMoved =
                Math.hypot(
                    position.xMeters - player.position.xMeters,
                    position.yMeters - player.position.yMeters,
                ) > 0.000001;
            player = {
                ...next,
                noiseRadiusMeters: hasMoved ? next.noiseRadiusMeters : 0,
                stamina: player.stamina + (next.stamina - player.stamina) * fraction,
                isExhausted: fraction === 1 ? next.isExhausted : player.isExhausted,
                position,
            };
        }

        return player;
    }

    private limitHistory(): void {
        if (this.pending.length > maxHistory) {
            // Loss of the replay history falls back to authority until a new connection.
            this.pending = [];
            this.acknowledged = null;
            this.isSuspended = true;
        }
    }
}
