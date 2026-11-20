import { movementSettings } from '@zombi-survive/content';
import type { PickupSnapshot } from '@zombi-survive/protocol';

const dragType = 'application/x-zombi-loot';
const retryTicks = movementSettings.ticksPerSecond / 2;

export const createLootDrag = ({
    nearby,
    inventory,
    zone,
    status,
    getReason,
    onPickup,
}: {
    readonly nearby: HTMLElement;
    readonly inventory: HTMLElement;
    readonly zone: HTMLElement;
    readonly status: HTMLElement;
    readonly getReason: (itemId: string) => string | null;
    readonly onPickup: (itemId: string) => void;
}): {
    request: (itemId: string) => void;
    accept: (snapshot: PickupSnapshot) => void;
    sync: () => void;
    reset: () => void;
    dispose: () => void;
} => {
    let drag: { itemId: string; source: HTMLElement } | null = null;
    let lastTick = -1;
    let feedbackId: string | null = null;
    const pending = new Map<string, number>();
    const finishDrag = (): void => {
        drag = null;
        delete zone.dataset['dragOver'];
    };
    const reset = (): void => {
        finishDrag();
        lastTick = -1;
        feedbackId = null;
        pending.clear();
        status.textContent = '';
    };
    const request = (itemId: string): void => {
        if (lastTick < 0 || pending.has(itemId) || getReason(itemId) !== null) return;

        pending.set(itemId, lastTick);
        onPickup(itemId);
    };
    const onDragStart = (event: DragEvent): void => {
        const { dataTransfer, target } = event;
        if (
            !(target instanceof HTMLElement) ||
            dataTransfer === null ||
            inventory.matches('[hidden]')
        )
            return;

        const itemId = target.dataset['lootDragId'];
        if (itemId === undefined) return;

        drag = { itemId, source: target };
        dataTransfer.effectAllowed = 'move';
        dataTransfer.setData(dragType, '');
        status.textContent = '';
        feedbackId = null;
    };
    const isCurrentDrag = (event: DragEvent): boolean =>
        drag !== null &&
        !inventory.matches('[hidden]') &&
        drag.source.isConnected &&
        drag.source.dataset['lootDragId'] === drag.itemId &&
        event.dataTransfer?.types.includes(dragType) === true;
    const onDragOver = (event: DragEvent): void => {
        if (!isCurrentDrag(event) || drag === null) return;

        event.preventDefault();
        zone.dataset['dragOver'] = getReason(drag.itemId) === null ? 'allowed' : 'blocked';
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
    };
    const onDragLeave = (event: DragEvent): void => {
        if (!(event.relatedTarget instanceof Node) || !zone.contains(event.relatedTarget))
            delete zone.dataset['dragOver'];
    };
    const onDrop = (event: DragEvent): void => {
        if (!isCurrentDrag(event) || drag === null) return;

        event.preventDefault();
        const { itemId } = drag;
        finishDrag();
        const reason = getReason(itemId);
        if (reason !== null) {
            status.textContent = reason;
            return;
        }

        feedbackId = itemId;
        status.textContent = 'Ожидание подтверждения хоста…';
        request(itemId);
    };
    const sync = (): void => {
        if (drag === null) return;

        if (inventory.matches('[hidden]')) {
            finishDrag();
            return;
        }
        if (!drag.source.isConnected || drag.source.dataset['lootDragId'] !== drag.itemId) {
            status.textContent = 'Источник больше недоступен.';
            finishDrag();
            return;
        }

        if (zone.dataset['dragOver'] !== undefined) {
            zone.dataset['dragOver'] = getReason(drag.itemId) === null ? 'allowed' : 'blocked';
        }
    };
    const onEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || drag === null) return;

        event.preventDefault();
        finishDrag();
    };

    nearby.addEventListener('dragstart', onDragStart);
    window.addEventListener('dragend', finishDrag);
    zone.addEventListener('dragover', onDragOver);
    zone.addEventListener('dragleave', onDragLeave);
    zone.addEventListener('drop', onDrop);
    document.addEventListener('keydown', onEscape, true);

    return {
        request,
        accept: snapshot => {
            lastTick = snapshot.tick;
            for (const [itemId, sentAt] of pending) {
                const isPicked = snapshot.items.some(item => item.itemId === itemId);
                const reason = getReason(itemId);
                if (!isPicked && reason === null && snapshot.tick - sentAt < retryTicks) continue;

                pending.delete(itemId);
                if (feedbackId !== itemId) continue;

                feedbackId = null;
                status.textContent = isPicked
                    ? 'Предмет в рюкзаке.'
                    : (reason ?? 'Хост не подтвердил подбор. Попробуйте снова.');
            }
        },
        sync,
        reset,
        dispose: () => {
            reset();
            nearby.removeEventListener('dragstart', onDragStart);
            window.removeEventListener('dragend', finishDrag);
            zone.removeEventListener('dragover', onDragOver);
            zone.removeEventListener('dragleave', onDragLeave);
            zone.removeEventListener('drop', onDrop);
            document.removeEventListener('keydown', onEscape, true);
        },
    };
};
