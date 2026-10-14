import type { MovementDirection, PlayerMovementState, WorldId } from '@zombi-survive/domain';
import type { MovementInputCommand, MovementSnapshot } from '@zombi-survive/protocol';
import { movementStepSeconds, stepPlayerMovement } from '@zombi-survive/simulation';

import { createMovementSnapshot, readMovementInput } from './movement-contract.ts';

type SessionInput = {
    lastReceivedSequence: number;
    lastProcessedSequence: number | null;
    pending: { command: MovementInputCommand; order: number } | null;
};

// Transport callbacks only stage intentions. Position and acknowledgements change on step().
export class LocalWorldMovement {
    private readonly sessions = new Map<string, SessionInput>();
    private tick = 0;
    private inputOrder = 0;
    private controllerId: string | null = null;
    private direction: MovementDirection = { x: 0, y: 0 };
    private lastInputTick = 0;
    private player: PlayerMovementState;
    private readonly worldId: WorldId;

    constructor(worldId: WorldId, playerId: string) {
        this.worldId = worldId;
        this.player = { playerId, position: { xMeters: 0, yMeters: 0 } };
    }

    join(sessionId: string): void {
        this.sessions.set(sessionId, {
            lastReceivedSequence: 0,
            lastProcessedSequence: null,
            pending: null,
        });
    }

    leave(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    receive(sessionId: string, value: unknown): void {
        const session = this.sessions.get(sessionId);
        const command = readMovementInput(value);

        if (session === undefined || command === null) {
            return;
        }

        if (command.sequence <= session.lastReceivedSequence) {
            return;
        }

        session.lastReceivedSequence = command.sequence;
        session.pending = { command, order: ++this.inputOrder };
    }

    step(): void {
        this.tick++;
        const pending = [...this.sessions.entries()]
            .filter(([, session]) => session.pending !== null)
            .sort(
                ([, first], [, second]) =>
                    (first.pending?.order ?? 0) - (second.pending?.order ?? 0),
            );

        for (const [sessionId, session] of pending) {
            const input = session.pending;

            if (input === null) {
                continue;
            }

            const { command } = input;
            const isMoving = command.direction.x !== 0 || command.direction.y !== 0;
            const isController = this.controllerId === sessionId;

            if (isMoving || isController) {
                this.controllerId = isMoving ? sessionId : null;
                this.direction = command.direction;
                this.lastInputTick = this.tick;
            }

            session.lastProcessedSequence = command.sequence;
            session.pending = null;
        }

        const isControllerPresent =
            this.controllerId !== null && this.sessions.has(this.controllerId);
        // Ten fixed steps = 0.5 seconds. A suspended or unreachable browser cannot keep walking.
        const isInputExpired = this.tick - this.lastInputTick >= 10;

        if (!isControllerPresent || isInputExpired) {
            this.controllerId = null;
            this.direction = { x: 0, y: 0 };
        }

        this.player = stepPlayerMovement(this.player, this.direction, movementStepSeconds);
    }

    snapshot(sessionId: string): MovementSnapshot {
        return createMovementSnapshot(
            this.worldId,
            this.tick,
            this.player,
            this.sessions.get(sessionId)?.lastProcessedSequence ?? null,
        );
    }
}
