import { itemDisplayName, pistolSettings } from '@zombi-survive/content';
import type { InventoryItem, Item } from '@zombi-survive/domain';
import type { HealthSnapshot, PickupSnapshot } from '@zombi-survive/protocol';

type LifeStatus = Pick<HealthSnapshot, 'tick' | 'lifeState' | 'lifeRevision'>;
type HeldEquipment = Pick<PickupSnapshot, 'tick' | 'hands' | 'items'>;
type EquipmentView = Pick<HeldEquipment, 'hands' | 'items'>;

export const trackConfirmedEquipment = (
    onChange: (equipment: EquipmentView | null) => void,
): {
    acceptEquipment: (snapshot: HeldEquipment) => void;
    acceptLife: (snapshot: LifeStatus) => void;
    reset: () => void;
} => {
    let life: LifeStatus | null = null;
    let equipment: HeldEquipment | null = null;
    let lifeStartTick = -1;

    const empty = (): void => {
        onChange({ hands: null, items: [] });
    };
    const sync = (): void => {
        if (life?.lifeState === 'dead') empty();
        else if (life !== null && equipment !== null && equipment.tick >= lifeStartTick) {
            const { hands, items } = equipment;
            onChange({ hands, items });
        }
    };

    return {
        acceptEquipment: snapshot => {
            equipment = snapshot;
            sync();
        },
        acceptLife: snapshot => {
            const { lifeState, lifeRevision, tick } = snapshot;
            if (
                life !== null &&
                ((life.lifeRevision ?? 0) !== (lifeRevision ?? 0) ||
                    (life.lifeState === 'dead' && lifeState === 'alive'))
            ) {
                lifeStartTick = tick;
                empty();
            }
            life = snapshot;
            sync();
        },
        reset: () => {
            life = null;
            equipment = null;
            lifeStartTick = -1;
            onChange(null);
        },
    };
};

const setText = (element: HTMLElement, text: string): void => {
    if (element.textContent !== text) element.textContent = text;
};

export const createEquipmentHud = ({
    heldItem,
    ammunition,
}: {
    readonly heldItem: HTMLElement;
    readonly ammunition: HTMLElement;
}): ReturnType<typeof trackConfirmedEquipment> =>
    trackConfirmedEquipment(equipment => {
        const hands: Item | null = equipment?.hands ?? null;
        const items: readonly InventoryItem[] = equipment?.items ?? [];
        const emptyLabel = equipment === null ? '—' : 'пусто';
        const name = hands === null ? emptyLabel : itemDisplayName(hands);
        setText(heldItem, `В руках: ${name}`);
        if (hands?.kind !== 'pistol') {
            if (ammunition.hidden !== true) ammunition.hidden = true;
            setText(ammunition, '');

            return;
        }

        const reserve = items.reduce(
            (total, item) => total + (item.kind === pistolSettings.ammoKind ? item.quantity : 0),
            0,
        );
        setText(
            ammunition,
            `Магазин: ${String(hands.rounds)}/${String(hands.magazineCapacity)} · Запас: ${String(reserve)}`,
        );
        if (ammunition.hidden !== false) ammunition.hidden = false;
    });
