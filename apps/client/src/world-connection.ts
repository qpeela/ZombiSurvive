import { Client, Room } from '@colyseus/sdk';
import {
    initialStateRequest,
    localWorldRoomId,
    type MovementSnapshot,
} from '@zombi-survive/protocol';

import { readMovementSnapshot } from './movement-contract';

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
): { connect: () => Promise<void>; disconnect: () => void; dispose: () => void } => {
    let activeRoom: Room<unknown> | null = null;
    let attempt = 0;
    let isDisposed = false;
    let abortController: AbortController | null = null;

    const closeRoom = (): void => {
        const room = activeRoom;
        activeRoom = null;
        room?.connection.close();
    };

    const connect = async (): Promise<void> => {
        if (isDisposed) {
            return;
        }

        const currentAttempt = ++attempt;
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
            room.onLeave(() => {
                if (isCurrentAttempt()) {
                    activeRoom = null;
                    onStateChange({ status: 'disconnected' });
                }
            });
            room.onError(() => {
                if (isCurrentAttempt()) {
                    closeRoom();
                    onStateChange({ status: 'error' });
                }
            });

            const value = await room.request<undefined, unknown>(initialStateRequest, undefined, {
                timeout: 10000,
            });
            const snapshot = readMovementSnapshot(value);

            if (snapshot === null) {
                throw new Error('Invalid initial world state.');
            }

            if (isCurrentAttempt() && activeRoom === room) {
                onStateChange({ status: 'connected', snapshot });
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

    const disconnect = (): void => {
        attempt++;
        abortController?.abort();
        closeRoom();
    };

    const dispose = (): void => {
        isDisposed = true;
        disconnect();
    };

    return { connect, disconnect, dispose };
};
