import type {
    MovementDirection,
    PlayerMovementState,
    WorldId,
    WorldPosition,
} from '@zombi-survive/domain';
import {
    maxWorldPlayers,
    type MovementInputCommand,
    type MovementSnapshot,
    type MovementTargetCommand,
} from '@zombi-survive/protocol';
import {
    movementStepSeconds,
    stepPlayerMovement,
    stepPlayerToward,
} from '@zombi-survive/simulation';

import {
    createMovementSnapshot,
    readMovementInput,
    readMovementTarget,
} from './movement-contract.ts';

type SessionInput = {
    playerId: string;
    lastReceivedSequence: number;
    lastProcessedSequence: number | null;
    pending: { command: MovementInputCommand | MovementTargetCommand; order: number } | null;
};

type PlayerInput = {
    player: PlayerMovementState;
    controllerId: string | null;
    direction: MovementDirection;
    target: WorldPosition | null;
    lastInputTick: number;
};

// Transport callbacks only stage intentions. Position and acknowledgements change on step().
export class LocalWorldMovement {
    private readonly sessions = new Map<string, SessionInput>();
    private tick = 0;
    private inputOrder = 0;
    private readonly players = new Map<string, PlayerInput>();
    private readonly soloPlayerId: string;
    private readonly worldId: WorldId;

    constructor(worldId: WorldId, playerId: string) {
        this.worldId = worldId;
        this.soloPlayerId = playerId;
    }

    join(sessionId: string, playerId = this.soloPlayerId): void {
        if (!this.players.has(playerId)) {
            if (this.players.size >= maxWorldPlayers) {
                throw new Error('World player limit reached.');
            }

            this.players.set(playerId, {
                player: {
                    playerId,
                    position: { xMeters: this.players.size * 2, yMeters: 0 },
                },
                controllerId: null,
                direction: { x: 0, y: 0 },
                target: null,
                lastInputTick: this.tick,
            });
        }

        this.sessions.set(sessionId, {
            playerId,
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
        const command = readMovementInput(value) ?? readMovementTarget(value);

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
            const player = this.players.get(session.playerId);

            if (player === undefined) {
                throw new Error('Session player is missing.');
            }

            const isMoving =
                command.type === 'movement-target' ||
                command.direction.x !== 0 ||
                command.direction.y !== 0;
            const isController = player.controllerId === sessionId;

            if (isMoving || isController) {
                player.controllerId = isMoving ? sessionId : null;
                player.direction =
                    command.type === 'movement-input' ? command.direction : { x: 0, y: 0 };
                player.target = command.type === 'movement-target' ? command.target : null;
                player.lastInputTick = this.tick;
            }

            session.lastProcessedSequence = command.sequence;
            session.pending = null;
        }

        for (const player of this.players.values()) {
            const isControllerPresent =
                player.controllerId !== null && this.sessions.has(player.controllerId);
            // Ten fixed steps = 0.5 seconds. An unreachable browser cannot keep walking.
            const isInputExpired = this.tick - player.lastInputTick >= 10;

            if (!isControllerPresent || isInputExpired) {
                player.controllerId = null;
                player.direction = { x: 0, y: 0 };
                player.target = null;
            }

            if (player.target !== null) {
                player.player = stepPlayerToward(player.player, player.target, movementStepSeconds);
            } else {
                player.player = stepPlayerMovement(
                    player.player,
                    player.direction,
                    movementStepSeconds,
                );
            }
        }
    }

    snapshot(sessionId: string): MovementSnapshot {
        const session = this.sessions.get(sessionId);
        const player = session === undefined ? undefined : this.players.get(session.playerId);

        if (player === undefined) {
            throw new Error('Cannot snapshot an unknown session.');
        }

        return createMovementSnapshot(
            this.worldId,
            this.tick,
            player.player,
            this.sessions.get(sessionId)?.lastProcessedSequence ?? null,
            [...this.players.values()].filter(other => other !== player).map(other => other.player),
        );
    }
}
