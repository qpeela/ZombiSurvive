import { Client, Room } from '@colyseus/sdk';
import type { MovementDirection } from '@zombi-survive/domain';
import {
    initialStateRequest,
    localWorldRoomId,
    type MovementSnapshot,
} from '@zombi-survive/protocol';

import { createMovementInput, readMovementSnapshot } from './movement-contract.js';

// The SDK exposes joined rooms only after the handshake. Retain the pending room
// so navigation or a handshake timeout can also close its socket.
class LocalWorldClient extends Client {
    private pendingRoom: Pick<Room<unknown>, 'connection'> | null = null;

    protected override createRoom<State>(name: string): Room<unknown, State> {
        const room = new Room<unknown, State>(name);
        room.reconnection.enabled = false;
        this.pendingRoom = room;

        return room;
    }

    cancelJoin(): void {
        this.pendingRoom?.connection.close();
        this.pendingRoom = null;
    }

    completeJoin(): void {
        this.pendingRoom = null;
    }
}

export type WorldConnectionState =
    | { readonly status: 'connecting' | 'disconnected' | 'error' }
    | { readonly status: 'connected'; readonly snapshot: MovementSnapshot };

export const createWorldConnection = (
    origin: string,
    onStateChange: (state: WorldConnectionState) => void,
): {
    connect: () => Promise<void>;
    sendMovement: (direction: MovementDirection) => void;
    disconnect: () => void;
    dispose: () => void;
} => {
    let activeRoom: Room<unknown> | null = null;
    let attempt = 0;
    let isDisposed = false;
    let abortController: AbortController | null = null;
    let sequence = 0;
    let isReady = false;

    const closeRoom = (): void => {
        const room = activeRoom;
        activeRoom = null;
        isReady = false;
        room?.connection.close();
    };

    const connect = async (): Promise<void> => {
        if (isDisposed) {
            return;
        }

        const currentAttempt = ++attempt;
        sequence = 0;
        abortController?.abort();
        closeRoom();
        const controller = new AbortController();
        abortController = controller;
        const client = new LocalWorldClient(origin, {
            fetchFn: (url, options) =>
                fetch(url, {
                    ...options,
                    signal: controller.signal,
                }),
        });
        const isCurrentAttempt = (): boolean => !isDisposed && attempt === currentAttempt;
        const timeout = window.setTimeout(() => {
            controller.abort();
        }, 10000);
        const interrupted = new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
                'abort',
                () => {
                    client.cancelJoin();

                    if (isCurrentAttempt()) {
                        closeRoom();
                    }

                    reject(new Error('Connection cancelled or timed out.'));
                },
                { once: true },
            );
        });
        onStateChange({ status: 'connecting' });

        try {
            const room: Room<unknown> = await Promise.race([
                client.joinById<unknown>(localWorldRoomId),
                interrupted,
            ]);
            client.completeJoin();

            if (!isCurrentAttempt()) {
                room.connection.close();

                return;
            }

            activeRoom = room;
            const received: { snapshot: MovementSnapshot | null } = { snapshot: null };
            const isActiveRoom = (): boolean => isCurrentAttempt() && activeRoom === room;
            const acceptSnapshot = (value: unknown): void => {
                if (!isActiveRoom()) {
                    return;
                }

                const snapshot = readMovementSnapshot(value);

                if (snapshot === null) {
                    closeRoom();
                    onStateChange({ status: 'error' });

                    return;
                }

                if (received.snapshot !== null) {
                    const isSameWorld = snapshot.worldId === received.snapshot.worldId;
                    const isSamePlayer =
                        snapshot.player.playerId === received.snapshot.player.playerId;

                    if (!isSameWorld || !isSamePlayer) {
                        closeRoom();
                        onStateChange({ status: 'error' });

                        return;
                    }

                    if (snapshot.tick <= received.snapshot.tick) {
                        return;
                    }
                }

                received.snapshot = snapshot;

                if (isReady) {
                    onStateChange({ status: 'connected', snapshot });
                }
            };
            room.onMessage<unknown>('movement-snapshot', acceptSnapshot);
            room.onLeave(() => {
                if (isActiveRoom()) {
                    activeRoom = null;
                    isReady = false;
                    onStateChange({ status: 'disconnected' });
                }
            });
            room.onError(() => {
                if (isActiveRoom()) {
                    closeRoom();
                    onStateChange({ status: 'error' });
                }
            });

            const value = await room.request<undefined, unknown>(initialStateRequest, undefined, {
                timeout: 10000,
            });
            acceptSnapshot(value);

            if (isActiveRoom() && received.snapshot !== null) {
                isReady = true;
                onStateChange({ status: 'connected', snapshot: received.snapshot });
            }
        } catch {
            if (isCurrentAttempt()) {
                closeRoom();
                onStateChange({ status: 'error' });
            }
        } finally {
            window.clearTimeout(timeout);
        }
    };

    const sendMovement = (direction: MovementDirection): void => {
        if (!isReady || activeRoom === null) {
            return;
        }

        try {
            activeRoom.send('movement-input', createMovementInput(++sequence, direction));
        } catch {
            closeRoom();
            onStateChange({ status: 'error' });
        }
    };

    const disconnect = (): void => {
        attempt++;
        abortController?.abort();
        closeRoom();
        onStateChange({ status: 'disconnected' });
    };

    const dispose = (): void => {
        isDisposed = true;
        disconnect();
    };

    return { connect, sendMovement, disconnect, dispose };
};
