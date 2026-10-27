import { Client, Room } from '@colyseus/sdk';
import type {
    InventoryCell,
    MovementDirection,
    MovementModifiers,
    WorldPosition,
} from '@zombi-survive/domain';
import {
    type HealthSnapshot,
    initialStateRequest,
    inventoryVersion,
    isHealthSnapshot,
    isMeleeSnapshot,
    isPickupSnapshot,
    isZombieSnapshot,
    localWorldRoomId,
    type MeleeIntent,
    type MeleeSnapshot,
    meleeVersion,
    type MovementInputCommand,
    type MovementSnapshot,
    type MovementTargetCommand,
    type PickupSnapshot,
    protocolVersion,
    type ZombieSnapshot,
} from '@zombi-survive/protocol';
import { placeInventoryItem } from '@zombi-survive/simulation';

import {
    createMovementInput,
    createMovementTarget,
    readMovementSnapshot,
} from './movement-contract.js';

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
    onCommandSent?: (command: MovementInputCommand | MovementTargetCommand) => void,
    onPickupChange?: (snapshot: PickupSnapshot) => void,
    onZombieChange?: (snapshot: ZombieSnapshot) => void,
    onHealthChange?: (snapshot: HealthSnapshot) => void,
    onMeleeChange?: (snapshot: MeleeSnapshot) => void,
): {
    connect: () => Promise<void>;
    sendMelee: (intent: MeleeIntent) => void;
    sendMovement: (direction: MovementDirection, modifiers?: MovementModifiers) => void;
    sendTarget: (target: WorldPosition, modifiers?: MovementModifiers) => void;
    pickUp: (itemId: string) => void;
    moveItem: (itemId: string, cell: InventoryCell) => void;
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
                    credentials: 'same-origin',
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
            let pickupTick = -1;
            room.onMessage<unknown>('pickup-state', value => {
                if (!isActiveRoom() || !isReady || received.snapshot === null) {
                    return;
                }

                if (!isPickupSnapshot(value)) {
                    closeRoom();
                    onStateChange({ status: 'error' });

                    return;
                }

                const isValidInventory = value.items.every(
                    item =>
                        placeInventoryItem({ items: value.items, item, cell: item.cell }) !== null,
                );

                if (!isValidInventory) {
                    closeRoom();
                    onStateChange({ status: 'error' });

                    return;
                }

                const isSameWorld = value.worldId === received.snapshot.worldId;
                const isSamePlayer = value.playerId === received.snapshot.player.playerId;

                if (!isSameWorld || !isSamePlayer) {
                    closeRoom();
                    onStateChange({ status: 'error' });

                    return;
                }

                if (value.tick <= pickupTick) {
                    return;
                }

                pickupTick = value.tick;
                onPickupChange?.(value);
            });
            let zombieTick = -1;
            room.onMessage<unknown>('zombie-state', value => {
                if (!isActiveRoom() || !isReady || received.snapshot === null) {
                    return;
                }

                if (!isZombieSnapshot(value)) {
                    closeRoom();
                    onStateChange({ status: 'error' });

                    return;
                }

                if (value.worldId !== received.snapshot.worldId) {
                    closeRoom();
                    onStateChange({ status: 'error' });

                    return;
                }

                if (value.tick <= zombieTick) {
                    return;
                }

                zombieTick = value.tick;
                onZombieChange?.(value);
            });
            let meleeTick = -1;
            room.onMessage<unknown>('melee-state', value => {
                if (!isActiveRoom() || !isReady || received.snapshot === null) return;

                if (!isMeleeSnapshot(value)) {
                    closeRoom();
                    onStateChange({ status: 'error' });
                    return;
                }
                const isSameWorld = value.worldId === received.snapshot.worldId;
                const isSamePlayer = value.playerId === received.snapshot.player.playerId;
                if (!isSameWorld || !isSamePlayer) {
                    closeRoom();
                    onStateChange({ status: 'error' });
                    return;
                }
                if (value.tick <= meleeTick) return;

                meleeTick = value.tick;
                onMeleeChange?.(value);
            });
            let healthTick = -1;
            room.onMessage<unknown>('health-state', value => {
                if (!isActiveRoom() || !isReady || received.snapshot === null) {
                    return;
                }

                if (!isHealthSnapshot(value)) {
                    closeRoom();
                    onStateChange({ status: 'error' });

                    return;
                }

                const isSameWorld = value.worldId === received.snapshot.worldId;
                const isSamePlayer = value.playerId === received.snapshot.player.playerId;

                if (!isSameWorld || !isSamePlayer) {
                    closeRoom();
                    onStateChange({ status: 'error' });

                    return;
                }

                if (value.tick <= healthTick) {
                    return;
                }

                healthTick = value.tick;
                onHealthChange?.(value);
            });
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

    const sendMovement = (
        direction: MovementDirection,
        modifiers: MovementModifiers = {},
    ): void => {
        if (!isReady || activeRoom === null) {
            return;
        }

        try {
            const command = createMovementInput(++sequence, direction, modifiers);
            activeRoom.send('movement-input', command);
            onCommandSent?.(command);
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

    const sendTarget = (target: WorldPosition, modifiers: MovementModifiers = {}): void => {
        if (!isReady || activeRoom === null) {
            return;
        }

        try {
            const command = createMovementTarget(++sequence, target, modifiers);
            activeRoom.send('movement-target', command);
            onCommandSent?.(command);
        } catch {
            closeRoom();
            onStateChange({ status: 'error' });
        }
    };

    const pickUp = (itemId: string): void => {
        if (!isReady || activeRoom === null) {
            return;
        }

        try {
            activeRoom.send('pickup-item', { type: 'pickup-item', protocolVersion, itemId });
        } catch {
            closeRoom();
            onStateChange({ status: 'error' });
        }
    };

    const moveItem = (itemId: string, cell: InventoryCell): void => {
        if (!isReady || activeRoom === null) {
            return;
        }

        try {
            activeRoom.send('inventory-move', {
                type: 'inventory-move',
                protocolVersion,
                inventoryVersion,
                itemId,
                cell,
            });
        } catch {
            closeRoom();
            onStateChange({ status: 'error' });
        }
    };

    const sendMelee = (intent: MeleeIntent): void => {
        if (!isReady || activeRoom === null) return;

        try {
            activeRoom.send(intent.type, { ...intent, protocolVersion, meleeVersion });
        } catch {
            closeRoom();
            onStateChange({ status: 'error' });
        }
    };

    const dispose = (): void => {
        isDisposed = true;
        disconnect();
    };

    return { connect, sendMelee, sendMovement, sendTarget, pickUp, moveItem, disconnect, dispose };
};
